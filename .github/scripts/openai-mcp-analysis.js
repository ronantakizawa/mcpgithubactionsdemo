// .github/scripts/openai-mcp-analysis.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { Octokit } from '@octokit/rest';

const execAsync = promisify(exec);

class GitHubMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "github-analysis-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  setupTools() {
    // Tool to get git diff
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'get_git_diff':
          return await this.getGitDiff(args.base, args.head);
        
        case 'get_file_content':
          return await this.getFileContent(args.path);
        
        case 'analyze_code_quality':
          return await this.analyzeCodeQuality(args.files);
        
        case 'get_pr_context':
          return await this.getPRContext();
        
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // Register available tools - same as before
    this.server.setRequestHandler('tools/list', async () => {
      return {
        tools: [
          {
            name: 'get_git_diff',
            description: 'Get git diff between two commits',
            inputSchema: {
              type: 'object',
              properties: {
                base: { type: 'string', description: 'Base commit SHA' },
                head: { type: 'string', description: 'Head commit SHA' }
              },
              required: ['base', 'head']
            }
          },
          {
            name: 'get_file_content',
            description: 'Get content of a specific file',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' }
              },
              required: ['path']
            }
          },
          {
            name: 'analyze_code_quality',
            description: 'Analyze code quality metrics',
            inputSchema: {
              type: 'object',
              properties: {
                files: { type: 'array', items: { type: 'string' } }
              },
              required: ['files']
            }
          },
          {
            name: 'get_pr_context',
            description: 'Get pull request context and metadata',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      };
    });
  }

  // Same tool methods as before...
  async getGitDiff(base, head) {
    try {
      const { stdout } = await execAsync(`git diff ${base}..${head} --name-only`);
      const changedFiles = stdout.trim().split('\n').filter(f => f);
      
      const { stdout: diffOutput } = await execAsync(`git diff ${base}..${head}`);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            changed_files: changedFiles,
            diff: diffOutput
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error getting git diff: ${error.message}`
        }]
      };
    }
  }

  async getFileContent(path) {
    try {
      const content = await fs.readFile(path, 'utf-8');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            path,
            content,
            size: content.length,
            lines: content.split('\n').length
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error reading file ${path}: ${error.message}`
        }]
      };
    }
  }

  async analyzeCodeQuality(files) {
    const analysis = {
      files_analyzed: files.length,
      issues: [],
      metrics: {}
    };

    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        
        const issues = [];
        if (lines.length > 500) {
          issues.push(`File ${file} is very large (${lines.length} lines)`);
        }
        
        if (content.includes('TODO') || content.includes('FIXME')) {
          issues.push(`File ${file} contains TODO/FIXME comments`);
        }
        
        analysis.issues.push(...issues);
        analysis.metrics[file] = {
          lines: lines.length,
          complexity: this.calculateComplexity(content)
        };
      } catch (error) {
        analysis.issues.push(`Could not analyze ${file}: ${error.message}`);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(analysis, null, 2)
      }]
    };
  }

  async getPRContext() {
    const context = {
      pr_number: process.env.PR_NUMBER,
      repo: `${process.env.REPO_OWNER}/${process.env.REPO_NAME}`,
      branch: process.env.GITHUB_HEAD_REF,
      base_branch: process.env.GITHUB_BASE_REF
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(context, null, 2)
      }]
    };
  }

  calculateComplexity(content) {
    const keywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'try', 'catch'];
    let complexity = 1;
    
    for (const keyword of keywords) {
      const matches = content.match(new RegExp(`\\b${keyword}\\b`, 'g'));
      if (matches) complexity += matches.length;
    }
    
    return complexity;
  }
}

// Main analysis function with OpenAI
async function runAnalysis() {
  try {
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Get PR information
    const prNumber = process.env.PR_NUMBER;
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    let prInfo = null;
    if (prNumber) {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: parseInt(prNumber),
      });
      prInfo = data;
    }

    // Get changed files
    const { stdout } = await execAsync('git diff --name-only HEAD~1 HEAD');
    const changedFiles = stdout.trim().split('\n').filter(f => f);

    // Read changed files for context
    const fileContents = {};
    for (const file of changedFiles.slice(0, 5)) {
      try {
        fileContents[file] = await fs.readFile(file, 'utf-8');
      } catch (error) {
        console.log(`Could not read ${file}: ${error.message}`);
      }
    }

    // Create analysis prompt
    const analysisPrompt = `
You are a senior software engineer reviewing code changes. Please analyze the following:

${prInfo ? `
PR Title: ${prInfo.title}
PR Description: ${prInfo.body}
` : ''}

Changed Files: ${changedFiles.join(', ')}

File Contents:
${Object.entries(fileContents).map(([file, content]) => 
  `--- ${file} ---\n${content.substring(0, 2000)}${content.length > 2000 ? '\n...(truncated)' : ''}`
).join('\n\n')}

Please provide:
1. Code quality assessment
2. Potential issues or improvements
3. Security considerations
4. Performance implications
5. Testing recommendations

Format your response as a detailed code review comment.
    `;

    // Use OpenAI API with function calling for MCP tools
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview', // or 'gpt-4o' for latest
      messages: [
        {
          role: 'system',
          content: 'You are a senior software engineer conducting code reviews. Provide detailed, actionable feedback.'
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ],
      max_tokens: 4000,
      temperature: 0.1, // Lower temperature for more consistent technical analysis
      tools: [
        {
          type: 'function',
          function: {
            name: 'analyze_code_metrics',
            description: 'Analyze code complexity and quality metrics',
            parameters: {
              type: 'object',
              properties: {
                files: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of files to analyze'
                }
              },
              required: ['files']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'get_code_context',
            description: 'Get additional context about code files',
            parameters: {
              type: 'object',
              properties: {
                filepath: {
                  type: 'string',
                  description: 'Path to the file'
                }
              },
              required: ['filepath']
            }
          }
        }
      ],
      tool_choice: 'auto'
    });

    let analysis = response.choices[0].message.content;

    // Handle function calls if the model wants to use tools
    if (response.choices[0].message.tool_calls) {
      const toolCalls = response.choices[0].message.tool_calls;
      
      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'analyze_code_metrics') {
          const args = JSON.parse(toolCall.function.arguments);
          // You could implement additional analysis here
          console.log('Tool call requested:', toolCall.function.name, args);
        }
      }
    }

    // Post as PR comment if this is a PR
    if (prNumber && prInfo) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: parseInt(prNumber),
        body: `## 🤖 AI Code Review (GPT-4)\n\n${analysis}`
      });

      console.log('Posted AI analysis as PR comment');
    } else {
      console.log('AI Analysis:');
      console.log(analysis);
    }

    // Create summary file
    await fs.writeFile('ai-analysis-summary.md', `# AI Code Analysis\n\n${analysis}`);
    console.log('Analysis complete. Summary saved to ai-analysis-summary.md');

  } catch (error) {
    console.error('Error running analysis:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  runAnalysis();
}