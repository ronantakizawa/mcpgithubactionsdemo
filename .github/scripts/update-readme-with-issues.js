// .github/scripts/update-readme-with-issues.js
import fs from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

class GitHubMCPClient {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async initialize() {
    console.log('🔧 Initializing GitHub MCP Server...');
    
    this.transport = new StdioClientTransport({
      command: 'docker',
      args: [
        'run',
        '-i',
        '--rm',
        '-e',
        'GITHUB_PERSONAL_ACCESS_TOKEN',
        'ghcr.io/github/github-mcp-server'
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN
      }
    });

    this.client = new Client({
      name: "readme-issues-updater",
      version: "1.0.0"
    }, {
      capabilities: {}
    });

    await this.client.connect(this.transport);
    console.log('✅ GitHub MCP Server connected');
  }

  async callTool(name, arguments_) {
    try {
      const result = await this.client.callTool({
        name,
        arguments: arguments_
      });
      return result;
    } catch (error) {
      console.error(`❌ Error calling MCP tool ${name}:`, error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('🔌 Disconnected from GitHub MCP Server');
    }
  }
}

async function fetchAllIssues(mcpClient, owner, repo) {
  console.log('📋 Fetching all issues...');
  
  const allIssues = [];
  let page = 1;
  const perPage = 100;
  
  while (true) {
    console.log(`📄 Fetching page ${page}...`);
    
    const result = await mcpClient.callTool('list_issues', {
      owner,
      repo,
      state: 'all', // Get both open and closed issues
      sort: 'updated',
      direction: 'desc',
      page,
      perPage
    });
    
    if (result.content[0]?.text) {
      const issues = JSON.parse(result.content[0].text);
      
      if (issues.length === 0) {
        break; // No more issues
      }
      
      allIssues.push(...issues);
      console.log(`✅ Fetched ${issues.length} issues from page ${page}`);
      
      if (issues.length < perPage) {
        break; // Last page
      }
      
      page++;
    } else {
      break;
    }
  }
  
  console.log(`📊 Total issues fetched: ${allIssues.length}`);
  return allIssues;
}

function categorizeIssues(issues) {
  const categories = {
    open: [],
    closed: [],
    bugs: [],
    enhancements: [],
    documentation: [],
    help_wanted: [],
    good_first_issue: []
  };
  
  issues.forEach(issue => {
    // Don't include pull requests (they have a pull_request property)
    if (issue.pull_request) {
      return;
    }
    
    // Basic state categorization
    if (issue.state === 'open') {
      categories.open.push(issue);
    } else {
      categories.closed.push(issue);
    }
    
    // Label-based categorization - safely handle missing labels
    const labels = (issue.labels || []).map(label => 
      typeof label === 'string' ? label.toLowerCase() : (label?.name || '').toLowerCase()
    );
    
    if (labels.some(l => l.includes('bug') || l.includes('error') || l.includes('fix'))) {
      categories.bugs.push(issue);
    }
    
    if (labels.some(l => l.includes('enhancement') || l.includes('feature') || l.includes('improvement'))) {
      categories.enhancements.push(issue);
    }
    
    if (labels.some(l => l.includes('documentation') || l.includes('docs'))) {
      categories.documentation.push(issue);
    }
    
    if (labels.some(l => l.includes('help wanted') || l.includes('help-wanted'))) {
      categories.help_wanted.push(issue);
    }
    
    if (labels.some(l => l.includes('good first issue') || l.includes('beginner'))) {
      categories.good_first_issue.push(issue);
    }
  });
  
  return categories;
}

function formatIssueForReadme(issue, includeState = true) {
  const state = issue.state === 'open' ? '🔓' : '🔒';
  const stateText = includeState ? ` ${state}` : '';
  
  // Safely handle labels
  const labels = (issue.labels || []);
  const labelText = labels.length > 0 
    ? ` \`${labels.map(l => typeof l === 'string' ? l : (l?.name || 'unknown')).join('`, `')}\``
    : '';
  
  // Safely handle assignee
  const assignee = issue.assignee 
    ? ` - Assigned to @${issue.assignee.login}`
    : '';
  
  return `- [#${issue.number}](${issue.html_url})${stateText} **${issue.title}**${labelText}${assignee}`;
}

function generateIssuesSection(categories, repoInfo) {
  const { owner, repo } = repoInfo;
  const timestamp = new Date().toISOString().split('T')[0];
  
  const openCount = categories.open.length;
  const closedCount = categories.closed.length;
  const totalCount = openCount + closedCount;
  
  let section = `## 📋 Current Issues

> **Repository:** [${owner}/${repo}](https://github.com/${owner}/${repo})  
> **Last Updated:** ${timestamp}  
> **Total Issues:** ${totalCount} (${openCount} open, ${closedCount} closed)

`;

  // Open Issues Section
  if (categories.open.length > 0) {
    section += `### 🔓 Open Issues (${categories.open.length})

`;
    
    categories.open.slice(0, 20).forEach(issue => {
      section += formatIssueForReadme(issue, false) + '\n';
    });
    
    if (categories.open.length > 20) {
      section += `\n... and ${categories.open.length - 20} more open issues. [View all open issues](https://github.com/${owner}/${repo}/issues?q=is%3Aissue+is%3Aopen)\n`;
    }
    section += '\n';
  }

  // Categorized Issues
  if (categories.bugs.length > 0) {
    section += `### 🐛 Bug Reports (${categories.bugs.length})

`;
    categories.bugs.slice(0, 10).forEach(issue => {
      section += formatIssueForReadme(issue) + '\n';
    });
    section += '\n';
  }

  if (categories.enhancements.length > 0) {
    section += `### ✨ Feature Requests & Enhancements (${categories.enhancements.length})

`;
    categories.enhancements.slice(0, 10).forEach(issue => {
      section += formatIssueForReadme(issue) + '\n';
    });
    section += '\n';
  }

  if (categories.help_wanted.length > 0) {
    section += `### 🆘 Help Wanted (${categories.help_wanted.length})

`;
    categories.help_wanted.slice(0, 5).forEach(issue => {
      section += formatIssueForReadme(issue) + '\n';
    });
    section += '\n';
  }

  if (categories.good_first_issue.length > 0) {
    section += `### 🌟 Good First Issues (${categories.good_first_issue.length})

`;
    categories.good_first_issue.forEach(issue => {
      section += formatIssueForReadme(issue) + '\n';
    });
    section += '\n';
  }

  // Recently Closed Issues
  const recentlyClosed = categories.closed
    .filter(issue => {
      const closedDate = new Date(issue.closed_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return closedDate > thirtyDaysAgo;
    })
    .slice(0, 10);

  if (recentlyClosed.length > 0) {
    section += `### ✅ Recently Closed Issues (${recentlyClosed.length})

`;
    recentlyClosed.forEach(issue => {
      section += formatIssueForReadme(issue) + '\n';
    });
    section += '\n';
  }

  // Summary Statistics
  section += `### 📊 Issue Statistics

| Category | Count |
|----------|-------|
| Total Issues | ${totalCount} |
| Open Issues | ${openCount} |
| Closed Issues | ${closedCount} |
| Bug Reports | ${categories.bugs.length} |
| Feature Requests | ${categories.enhancements.length} |
| Documentation | ${categories.documentation.length} |
| Help Wanted | ${categories.help_wanted.length} |
| Good First Issues | ${categories.good_first_issue.length} |

---

*This section is automatically updated by GitHub Actions using the [GitHub MCP Server](https://github.com/github/github-mcp-server). Last update: ${new Date().toISOString()}*

`;

  return section;
}

async function updateReadme(issuesSection) {
  console.log('📝 Updating README.md...');
  
  let readmeContent = '';
  
  try {
    readmeContent = await fs.readFile('README.md', 'utf-8');
    console.log('✅ Existing README.md found');
  } catch (error) {
    console.log('⚠️ README.md not found, creating new one...');
    readmeContent = `# Project Title

Welcome to this project!

`;
  }

  // Remove existing issues section if it exists
  const issuesSectionRegex = /## 📋 Current Issues[\s\S]*?(?=##|$)/;
  readmeContent = readmeContent.replace(issuesSectionRegex, '');

  // Add new issues section
  readmeContent = readmeContent.trim() + '\n\n' + issuesSection;

  await fs.writeFile('README.md', readmeContent);
  console.log('✅ README.md updated successfully');
}

async function main() {
  let mcpClient = null;
  
  try {
    console.log('🚀 Starting README issues update...');
    
    // Validate environment
    const githubToken = process.env.GITHUB_TOKEN;
    const repoOwner = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY?.split('/')[0];
    const repoName = process.env.REPO_NAME || process.env.GITHUB_REPOSITORY?.split('/')[1];
    
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    if (!repoOwner || !repoName) {
      throw new Error('Repository information not available. Set REPO_OWNER/REPO_NAME or GITHUB_REPOSITORY');
    }
    
    console.log(`📊 Updating README for repository: ${repoOwner}/${repoName}`);

    // Initialize MCP client
    mcpClient = new GitHubMCPClient();
    await mcpClient.initialize();

    // Fetch all issues
    const issues = await fetchAllIssues(mcpClient, repoOwner, repoName);
    
    if (issues.length === 0) {
      console.log('ℹ️ No issues found in repository');
      return;
    }

    // Categorize issues
    console.log('🔍 Debug: Sample issue structure...');
    if (issues.length > 0) {
      const sampleIssue = issues[0];
      console.log('Sample issue keys:', Object.keys(sampleIssue));
      console.log('Sample issue labels:', sampleIssue.labels);
      console.log('Sample issue state:', sampleIssue.state);
      console.log('Sample issue number:', sampleIssue.number);
    }
    
    let categories;
    try {
      categories = categorizeIssues(issues);
    } catch (categorizationError) {
      console.error('❌ Error during issue categorization:', categorizationError.message);
      console.log('🔍 Issues data for debugging:', JSON.stringify(issues.slice(0, 2), null, 2));
      throw categorizationError;
    }
    console.log('📊 Issue categorization complete:');
    console.log(`- Open: ${categories.open.length}`);
    console.log(`- Closed: ${categories.closed.length}`);
    console.log(`- Bugs: ${categories.bugs.length}`);
    console.log(`- Enhancements: ${categories.enhancements.length}`);
    console.log(`- Help Wanted: ${categories.help_wanted.length}`);
    console.log(`- Good First Issues: ${categories.good_first_issue.length}`);

    // Generate issues section
    const issuesSection = generateIssuesSection(categories, {
      owner: repoOwner,
      repo: repoName
    });

    // Update README
    await updateReadme(issuesSection);

    console.log('🎉 README.md has been successfully updated with current issues!');

  } catch (error) {
    console.error('💥 Error updating README with issues:', error.message);
    console.error('📍 Full error stack:', error.stack);
    process.exit(1);
  } finally {
    if (mcpClient) {
      await mcpClient.disconnect();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Received interrupt signal, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received termination signal, shutting down gracefully...');
  process.exit(0);
});

main();