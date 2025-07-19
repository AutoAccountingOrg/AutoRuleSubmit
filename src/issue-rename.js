const { Octokit } = require('@octokit/rest');

class IssueRenamer {
  constructor(token, owner, repo) {
    this.octokit = new Octokit({
      auth: token
    });
    this.owner = owner;
    this.repo = repo;
  }

  async renameIssue(issueNumber) {
    try {
      // 获取issue信息
      const { data: issue } = await this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      });

      const originalTitle = issue.title;
      console.log(`原始标题: ${originalTitle}`);

      // 匹配格式: [Adaptation Request][DATA]内容 或 [Bug Report][DATA]内容
      const adaptationRegex = originalTitle.match(/\[Adaptation Request\]\[(.*?)\](.*)/);
      const bugReportRegex = originalTitle.match(/\[Bug Report\]\[(.*?)\](.*)/);

      if (adaptationRegex && adaptationRegex.length >= 3) {
        const label = adaptationRegex[1];
        const content = adaptationRegex[2];

        console.log(`解析结果:`);
        console.log(`  类型: 适配请求`);
        console.log(`  标签: ${label}`);
        console.log(`  内容: ${content}`);

        // 重命名标题
        const newTitle = `适配请求：${content}`;
        console.log(`新标题: ${newTitle}`);

        // 更新issue标题
        await this.octokit.issues.update({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          title: newTitle
        });

        // 添加标签（包括类型标签）
        await this.octokit.issues.addLabels({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          labels: [label, 'adaptation-request']
        });

        console.log(`✅ Issue #${issueNumber} 重命名成功`);
        console.log(`✅ 已添加标签: ${label}, adaptation-request`);

      } else if (bugReportRegex && bugReportRegex.length >= 3) {
        const label = bugReportRegex[1];
        const content = bugReportRegex[2];

        console.log(`解析结果:`);
        console.log(`  类型: Bug反馈`);
        console.log(`  标签: ${label}`);
        console.log(`  内容: ${content}`);

        // 重命名标题
        const newTitle = `Bug反馈：${content}`;
        console.log(`新标题: ${newTitle}`);

        // 更新issue标题
        await this.octokit.issues.update({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          title: newTitle
        });

        // 添加标签（包括类型标签）
        await this.octokit.issues.addLabels({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          labels: [label, 'bug-report']
        });

        console.log(`✅ Issue #${issueNumber} 重命名成功`);
        console.log(`✅ 已添加标签: ${label}, bug-report`);

      } else {
        console.log('❌ 标题格式不符合要求');
        console.log('支持的格式:');
        console.log('  [Adaptation Request][标签]内容');
        console.log('  [Bug Report][标签]内容');
        console.log('示例:');
        console.log('  [Adaptation Request][DATA]com.tencent.mm');
        console.log('  [Bug Report][BUG]规则解析错误');

        // 标记为invalid并添加提示信息
        await this.octokit.issues.addLabels({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          labels: ['invalid']
        });

        // 添加评论说明
        await this.octokit.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          body: `## ❌ 格式错误

此Issue的标题格式不符合要求。

### 支持的格式：
- \`[Adaptation Request][标签]内容\` - 适配请求
- \`[Bug Report][标签]内容\` - Bug反馈

### 示例：
- \`[Adaptation Request][DATA]com.tencent.mm\`
- \`[Bug Report][BUG]规则解析错误\`

### 请使用自动记账App提交：
1. 打开自动记账App
2. 点击【数据】标签页
3. 找到你要编写规则的数据
4. 点击【上传】图标上传

**注意：** 请勿直接在GitHub上创建Issue，请使用App提交功能。`
        });

        console.log(`❌ Issue #${issueNumber} 已标记为invalid`);
        console.log(`📝 已添加格式说明评论`);
        return false;
      }

      return true;

    } catch (error) {
      console.error('❌ 操作失败:', error.message);
      if (error.status === 404) {
        console.error('Issue不存在或没有访问权限');
      } else if (error.status === 401) {
        console.error('TOKEN无效或权限不足');
      }
      return false;
    }
  }
}

module.exports = IssueRenamer; 