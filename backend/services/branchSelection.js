// branchSelection.js — 用户手动勾选分店（最多 7 家，所有品牌合计）
// 纯函数，不依赖数据库，方便单独测试

const MAX_SELECTED_BRANCHES = 7;

// 校验前端传来的 branchIds；合法返回 null，不合法返回英文错误信息
function validateBranchIds(branchIds) {
    if (!Array.isArray(branchIds)) {
        return 'branchIds must be an array of branch IDs.';
    }
    if (branchIds.some(id => typeof id !== 'string' || id.trim() === '')) {
        return 'Each branchId must be a non-empty string.';
    }
    if (new Set(branchIds).size !== branchIds.length) {
        return 'branchIds must not contain duplicates.';
    }
    if (branchIds.length > MAX_SELECTED_BRANCHES) {
        return `You can select at most ${MAX_SELECTED_BRANCHES} branches (got ${branchIds.length}).`;
    }
    return null;
}

// 只保留被勾选的分店；没勾选任何分店（空数组或缺失）时原样返回，保持默认行为
function filterBranchesBySelection(branches, branchIds) {
    if (!Array.isArray(branchIds) || branchIds.length === 0) return branches;
    const allowed = new Set(branchIds);
    return branches.filter(b => allowed.has(b.branchId));
}

module.exports = { MAX_SELECTED_BRANCHES, validateBranchIds, filterBranchesBySelection };
