/**
 * FactChecker 测试脚本
 * 
 * 用于验证事实核查功能
 * 
 * 使用方法：
 * 1. 确保后端服务已启动
 * 2. 运行：node dist/test-fact-checker.js
 */

// 测试用例
const testCases = [
  {
    name: '公司收购关系',
    text: '腾讯收购了 Riot Games',
    expected: {
      subject: '腾讯',
      predicate: 'ACQUIRED',
      object: 'Riot Games',
    },
  },
  {
    name: '子公司关系',
    text: 'Instagram 是 Facebook 的子公司',
    expected: {
      subject: 'Instagram',
      predicate: 'SUBSIDIARY_OF',
      object: 'Facebook',
    },
  },
  {
    name: '投资关系',
    text: '软银投资了阿里巴巴',
    expected: {
      subject: '软银',
      predicate: 'INVESTED_IN',
      object: '阿里巴巴',
    },
  },
]

console.log('FactChecker 测试用例：\n')
testCases.forEach((tc) => {
  console.log(`测试：${tc.name}`)
  console.log(`文本：${tc.text}`)
  console.log(`期望提取：${JSON.stringify(tc.expected, null, 2)}`)
  console.log('---')
})

console.log('\n提示：需要在后端服务启动后，通过 API 调用测试实际的事实核查功能')
