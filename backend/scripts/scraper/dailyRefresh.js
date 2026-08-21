/**
 * 每日刷新编排脚本：把"抓取 → 导入数据库 → 补 unitPrice"这一整套流程串起来，
 * 两个超市牌子依次跑（不同时跑），中间也加随机间隔，避免叠加请求触发限速。
 *
 * 可以手动跑一次：
 *   node dailyRefresh.js
 * 也可以被 scheduler.js 用 node-cron 定时调用（见 scheduler.js）。
 */
const path = require('path');
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

  for (let i = 0; i < chains.length; i++) {
    try {
      const result = await refreshChain(chains[i]);
      results.push(result);
    } catch (err) {
      // 一个牌子失败不影响另一个牌子继续跑，把错误记下来就好，
      // 不要让整个每日刷新因为其中一个牌子出问题就整体中断
      console.error(`[${chains[i]}] 刷新失败: ${err.message}`);
      results.push({ chainKey: chains[i], error: err.message });
    }

    // 换牌子之间歇久一点（2-5分钟），跟换分类的间隔（几秒钟级别）不是一个量级，
    // 因为这是"整个牌子跑完"之后的休息，不是翻页之间的休息
    if (i < chains.length - 1) {
      const waitMinutes = 2 + Math.random() * 3;
      console.log(`\n换牌子前先歇约 ${waitMinutes.toFixed(1)} 分钟...`);
      await new Promise((resolve) => setTimeout(resolve, waitMinutes * 60000));
    }
  }

  await mongoose.disconnect();

  const finishedAt = new Date();
  const durationMin = ((finishedAt - startedAt) / 60000).toFixed(1);
  console.log(`\n===== 每日刷新结束: ${finishedAt.toISOString()} (耗时约 ${durationMin} 分钟) =====`);

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
