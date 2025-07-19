#!/usr/bin/env node

const { Command } = require('commander');
const IssueRenamer = require('./issue-rename');
const IssueTester = require('./issue-test');

const program = new Command();

program
  .name('auto-rule-submit')
  .description('一个简单的命令行工具')
  .version('1.0.0');

program
  .command('hello')
  .description('打招呼')
  .action(() => {
    console.log('你好！这是一个简单的命令行工具。');
  });

program
  .command('info')
  .description('显示工具信息')
  .action(() => {
    console.log('工具名称: auto-rule-submit');
    console.log('版本: 1.0.0');
    console.log('描述: 一个简单的命令行工具');
  });

program
  .command('rename')
  .description('重命名issue标题')
  .argument('<issue>', 'issue编号')
  .option('-t, --token <token>', 'GitHub TOKEN', process.env.GITHUB_TOKEN)
  .action(async (issue, options) => {
    // 硬编码仓库信息
    const owner = 'AutoAccountingOrg';
    const repo = 'AutoRuleSubmit';
    
    // 检查必要的环境变量
    if (!options.token) {
      console.error('❌ 错误: 缺少 GITHUB_TOKEN 环境变量');
      console.log('请设置环境变量: export GITHUB_TOKEN=your_token');
      process.exit(1);
    }

    console.log(`🔧 配置信息:`);
    console.log(`  仓库: ${owner}/${repo}`);
    console.log(`  Issue: #${issue}`);

    // 创建重命名器实例
    const renamer = new IssueRenamer(options.token, owner, repo);
    
    // 执行重命名
    const success = await renamer.renameIssue(parseInt(issue));
    
    if (!success) {
      process.exit(1);
    }
  });

program
  .command('test')
  .description('测试issue内容')
  .argument('[issue]', 'issue编号（可选，不提供则测试所有open的issues）')
  .option('-t, --token <token>', 'GitHub TOKEN', process.env.GITHUB_TOKEN)
  .action(async (issue, options) => {
    // 硬编码仓库信息
    const owner = 'AutoAccountingOrg';
    const repo = 'AutoRule';
    
    // 检查必要的环境变量
    if (!options.token) {
      console.error('❌ 错误: 缺少 GITHUB_TOKEN 环境变量');
      console.log('请设置环境变量: export GITHUB_TOKEN=your_token');
      process.exit(1);
    }

    console.log(`🔧 配置信息:`);
    console.log(`  仓库: ${owner}/${repo}`);
    if (issue) {
      console.log(`  Issue: #${issue}`);
    } else {
      console.log(`  测试所有open的issues`);
    }

    // 创建测试器实例
    const tester = new IssueTester(options.token, owner, repo);
    
    // 执行测试
    let success;
    if (issue) {
      success = await tester.testIssue(parseInt(issue));
    } else {
      success = await tester.testAllIssues();
    }
    
    if (!success) {
      process.exit(1);
    }
  });

program.parse();
