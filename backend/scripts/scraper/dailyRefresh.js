/**
 * 每日刷新编排脚本：把"抓取 → 导入数据库 → 补 unitPrice"这一整套流程串起来，
 * 两个超市牌子依次跑（不同时跑），中间也加随机间隔，避免叠加请求触发限速。
 *
 * 可以手动跑一次：
 *   node dailyRefresh.js
 * 也可以被 scheduler.js 用 node-cron 定时调用（见 scheduler.js）。
 */
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const { runBatchForChain } = require('./runBatch.js');
const { importFile } = require('./importToDb.js');
const { backfillFile } = require('./backfillUnitPrice.js');

function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 只读地记录抓取过程中每个请求的 HTTP 状态码（按牌子分开统计），
 * 用来在日志里看出是不是被网站拦了（比如一整排 403）。
 * 拦截器只记数，响应和错误都原样往下传，不改变抓取逻辑。
 * 返回 { setChain, eject }
 */
function trackHttpStatuses(statusCounts) {
  let currentChain = null;
  const record = (status) => {
    if (!currentChain) return;
    const counts = (statusCounts[currentChain] = statusCounts[currentChain] || {});
    counts[status] = (counts[status] || 0) + 1;
  };
  const id = axios.interceptors.response.use(
    (response) => {
      record(response.status);
      return response;
    },
    (error) => {
      // 没有响应的（超时、断网）记错误码，比如 ECONNABORTED
      record(error.response ? error.response.status : error.code || 'NO_RESPONSE');
      return Promise.reject(error);
    }
  );
  return {
    setChain: (chainKey) => { currentChain = chainKey; },
    eject: () => axios.interceptors.response.eject(id),
  };
}

// { 403: 7, 200: 2 } -> "200 x2, 403 x7"
function formatStatusCounts(counts) {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) return '无请求记录';
  return entries
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([status, n]) => `${status} x${n}`)
    .join(', ');
}

/**
 * 跑完一个牌子的完整流程：抓取 -> 导入数据库 -> 补 unitPrice
 */
async function refreshChain(chainKey) {
  console.log(`\n########## 开始刷新: ${chainKey} ##########`);

  const { outFile, count } = await runBatchForChain(chainKey);
  console.log(`[${chainKey}] 抓取完成，共 ${count} 个商品`);

  const importResult = await importFile(outFile);
  console.log(
    `[${chainKey}] 导入完成，新建 ${importResult.created} / 更新 ${importResult.updated}`
  );

  const backfillResult = await backfillFile(outFile);
  console.log(`[${chainKey}] unitPrice 回填完成，补上 ${backfillResult.updated} 条`);

  return { chainKey, count, importResult, backfillResult };
}

/**
 * 完整刷新一次：Pak'nSave 和 New World 依次跑，不同时跑，
 * 中间随机歇 2-5 分钟，避免两边请求叠加在一起。
 */
async function runDailyRefresh() {
  const startedAt = new Date();
  console.log(`===== 每日刷新开始: ${startedAt.toISOString()} =====`);

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('没有找到 MONGODB_URI，检查一下项目根目录的 .env.local 文件');
  }

  await mongoose.connect(mongoUri);
  console.log('数据库已连接');

  const results = [];
  const chains = ['paknsave', 'newworld'];
  const statusCounts = {};
  const statusTracker = trackHttpStatuses(statusCounts);

  for (let i = 0; i < chains.length; i++) {
    statusTracker.setChain(chains[i]);
    try {
      const result = await refreshChain(chains[i]);
      results.push(result);
      if (result.count === 0) {
        // 网站返回拦截页（比如 Cloudflare 403）时，抓取不会报错，只是一个商品都抓不到
        console.error(`[${chains[i]}] 错误: 抓到 0 个商品，可能被网站拒绝`);
      }
    } catch (err) {
      // 一个牌子失败不影响另一个牌子继续跑，把错误记下来就好，
      // 不要让整个每日刷新因为其中一个牌子出问题就整体中断
      console.error(`[${chains[i]}] 刷新失败: ${err.message}`);
      results.push({ chainKey: chains[i], error: err.message });
    }
    console.log(`[${chains[i]}] HTTP 状态码: ${formatStatusCounts(statusCounts[chains[i]])}`);
    statusTracker.setChain(null);

    // 换牌子之间歇久一点（2-5分钟），跟换分类的间隔（几秒钟级别）不是一个量级，
    // 因为这是"整个牌子跑完"之后的休息，不是翻页之间的休息
    if (i < chains.length - 1) {
      const waitMinutes = 2 + Math.random() * 3;
      console.log(`\n换牌子前先歇约 ${waitMinutes.toFixed(1)} 分钟...`);
      await new Promise((resolve) => setTimeout(resolve, waitMinutes * 60000));
    }
  }

  statusTracker.eject();
  await mongoose.disconnect();

  const finishedAt = new Date();
  const durationMin = ((finishedAt - startedAt) / 60000).toFixed(1);
  console.log(`\n===== 每日刷新结束: ${finishedAt.toISOString()} (耗时约 ${durationMin} 分钟) =====`);

  // 汇总：每个牌子的商品数 + 状态码分布，一行看完
  const summary = results
    .map((r) => {
      const countText = r.error ? `失败(${r.error})` : `${r.count} 个商品`;
      return `${r.chainKey}: ${countText} [${formatStatusCounts(statusCounts[r.chainKey])}]`;
    })
    .join(' | ');
  console.log(`汇总: ${summary}`);

  // 有牌子抓到 0 个商品（或整个牌子刷新失败）时，以非零退出码结束，让定时任务能看出来失败了
  const failedChains = results.filter((r) => r.error || r.count === 0).map((r) => r.chainKey);
  if (failedChains.length > 0) {
    console.error(`每日刷新有失败的牌子: ${failedChains.join(', ')}，退出码设为 1`);
    process.exitCode = 1;
  }

  return results;
}

// 命令行直接跑：node dailyRefresh.js
if (require.main === module) {
  runDailyRefresh().catch((err) => {
    console.error('每日刷新失败:', err.message);
    process.exit(1);
  });
}

module.exports = { runDailyRefresh, refreshChain };
