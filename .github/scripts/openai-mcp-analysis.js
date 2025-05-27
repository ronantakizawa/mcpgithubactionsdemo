// .github/scripts/openai-mcp-analysis.js
import OpenAI from 'openai';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { Octokit } from '@octokit/rest';

const execAsync = promisify(exec);

async function runAnalysis() {
  try {
    console.log('🚀 Starting AI analysis...');
    
    // Debug: Check if API key exists
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    console.log('✅ OpenAI API key found:', apiKey.substring(0, 10) + '...');

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Get PR information
    const prNumber = process.env.PR_NUMBER;
    const githubRepo = process.env.GITHUB_REPOSITORY;
    
    console.log('📋 Environment variables:');
    console.log('- PR_NUMBER:', prNumber);
    console.log('- GITHUB_REPOSITORY:', githubRepo);
    
    if (!githubRepo) {
      throw new Error('GITHUB_REPOSITORY environment variable is not set');
    }
    
    const [owner, repo] = githubRepo.split('/');
    console.log(`📊 Analyzing repo: ${owner}/${repo}, PR: ${prNumber || 'N/A'}`);

    let prInfo = null;
    if (prNumber) {
      try {
        const { data } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: parseInt(prNumber),
        });
        prInfo = data;
        console.log(`📝 PR Title: ${prInfo.title}`);
      } catch (error) {
        console.log('⚠️ Could not get PR info:', error.message);
      }
    }

    // Get changed files
    console.log('🔍 Getting changed files...');
    const { stdout } = await execAsync('git diff --name-only HEAD~1 HEAD');
    const changedFiles = stdout.trim().split('\n').filter(f => f);
    
    console.log('📁 Changed files:', changedFiles);

    if (changedFiles.length === 0) {
      console.log('❌ No files changed, skipping analysis');
      return;
    }

    // Read changed files for context (limit to first 2 files)
    const fileContents = {};
    for (const file of changedFiles.slice(0, 2)) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        fileContents[file] = content.substring(0, 1000); // Limit content size
        console.log(`📖 Read file: ${file} (${content.length} chars, truncated to 1000)`);
      } catch (error) {
        console.log(`❌ Could not read ${file}: ${error.message}`);
      }
    }

    // Create analysis prompt
    const analysisPrompt = `You are a senior software engineer reviewing code changes.

${prInfo ? `PR: ${prInfo.title}` : 'Direct push'}

Changed Files: ${changedFiles.join(', ')}

File Contents:
${Object.entries(fileContents).map(([file, content]) => 
  `--- ${file} ---\n${content}\n`
).join('\n')}

Please provide a brief code review with:
1. Overall assessment
2. Any issues or improvements
3. Recommendations

Keep response under 300 words.`;

    console.log('🤖 Calling OpenAI API...');
    console.log('📏 Prompt length:', analysisPrompt.length, 'characters');

    // Test OpenAI API with minimal call first
    try {
      const testResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // Use cheaper model for testing
        messages: [
          {
            role: 'user',
            content: 'Hello, this is a test. Please respond with "API working".'
          }
        ],
        max_tokens: 10,
      });
      
      console.log('✅ OpenAI API test successful:', testResponse.choices[0]?.message?.content);
    } catch (testError) {
      console.error('❌ OpenAI API test failed:', testError.message);
      throw testError;
    }

    // Now make the actual analysis call
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful code reviewer. Be concise and constructive.'
        },
        {
          role: 'user',
          content: analysisPrompt
        }
      ],
      max_tokens: 500,
      temperature: 0.1,
    });

    const analysis = response.choices[0]?.message?.content;
    
    console.log('📊 OpenAI Response received');
    console.log('- Choices count:', response.choices?.length);
    console.log('- Content length:', analysis?.length);
    console.log('- Content preview:', analysis?.substring(0, 100) + '...');
    
    if (!analysis) {
      throw new Error('No analysis content generated from OpenAI');
    }

    console.log('📝 Full AI Analysis:');
    console.log(analysis);

    // Post as PR comment if this is a PR
    if (prNumber && prInfo) {
      try {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: parseInt(prNumber),
          body: `## 🤖 AI Code Review\n\n${analysis}`
        });
        console.log('✅ Posted AI analysis as PR comment');
      } catch (error) {
        console.log('❌ Could not post PR comment:', error.message);
      }
    }

    // Create summary file
    await fs.writeFile('ai-analysis-summary.md', `# AI Code Analysis\n\n${analysis}`);
    console.log('✅ Analysis complete. Summary saved to ai-analysis-summary.md');

  } catch (error) {
    console.error('💥 Error running analysis:', error.message);
    console.error('📍 Full error stack:', error.stack);
    process.exit(1);
  }
}

runAnalysis();