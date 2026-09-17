require('dotenv').config();
const { getConfigManager } = require('../utils/configManager');

// 从配置管理器获取运行时配置
function getConfig() {
  const configManager = getConfigManager();
  return configManager.getAll();
}

module.exports = getConfig();
module.exports.getConfig = getConfig;
