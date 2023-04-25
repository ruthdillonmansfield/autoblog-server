const { Configuration, OpenAIApi } = require("openai");
const cron  = require('node-cron');
const express  = require('express');
const cors  = require('cors');
const dotenv = require('dotenv');
const { Octokit } = require('@octokit/core');

dotenv.config();


const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const octokit = new Octokit({ auth: process.env.OCTOKIT_KEY });

const repoOwner = 'ruthdillonmansfield';
const repoName = 'autoblog-front-end-next';
const branch = 'main';

const app = express();
app.use(cors());


app.get('/generate', async (req, res) => {
  try {
    await generateAndSaveBlogPost();
    console.log("Success!")
    res.status(200).json({ message: 'Blog post generated and saved successfully.' });
  } catch (error) {
    console.error('Error while generating and saving the blog post:', error);
    res.status(500).json({ message: 'Failed to generate and save blog post.', error: error.message });
  }
});

async function fetchLast20Files() {
  const listFilesResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: repoOwner,
    repo: repoName,
    path: 'posts',
    ref: branch,
  });

  return listFilesResponse.data.slice(-20);
}

async function fetchLast20Titles(last20Files) {
  const last20TitlesPromises = last20Files.map(async (file) => {
    const fileContentResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: repoOwner,
      repo: repoName,
      path: file.path,
      ref: branch,
    });

    const fileContent = Buffer.from(fileContentResponse.data.content, 'base64').toString();

    // Extract the title from the Markdown front matter
    const titleMatch = fileContent.match(/title:\s*['"](.+?)['"]/);
    const title = titleMatch ? titleMatch[1] : 'Untitled';

    return title;
  });

  return await Promise.all(last20TitlesPromises);
}


async function generateTitle() {
  const openAITitleResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: 'Come up with one SEO-friendly blog title',
    temperature: 0.9,
    max_tokens: 750,
    top_p: 1.0,
  });

  return openAITitleResponse.data.choices[0].text.replace(/^[\n\s"]+|[\n\s"]+$/g, '');
}

async function generateContent(title) {
  const promptContents = `Now write 2-3 paragraphs of no more than 80 words, structured with HTML, and including headings and paragraphs. The blog must be based on this title: ${title}`;

  const openaiContentsResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: promptContents,
    temperature: 0.7,
    max_tokens: 750,
    top_p: 1.0,
  });

  return openaiContentsResponse.data.choices[0].text;
}

async function saveBlogPost(filePath, markdownString, outputTitle) {
  const base64EncodedContent = Buffer.from(markdownString).toString('base64');

  let sha;

  try {
    const getFileResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: repoOwner,
      repo: repoName,
      path: filePath,
      ref: branch
    });

    sha = getFileResponse.data.sha;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const createOrUpdateFileRequest = {
    owner: repoOwner,
    repo: repoName,
    path: filePath,
    message: `Add new blog post: ${outputTitle}`,
    content: base64EncodedContent,
    branch: branch
  };

  if (sha) {
    createOrUpdateFileRequest.sha = sha;
  }

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', createOrUpdateFileRequest);
}

async function generateAndSaveBlogPost() {
  try {
    const last20Files = await fetchLast20Files();
    console.log("Fetched 20 files.");

    const last20Titles = await fetchLast20Titles(last20Files);
    console.log("Fetched 20 titles: ", last20Titles);

    const outputTitle = await generateTitle();
    console.log(`Output title is ${outputTitle}`);
    
    const outputContent = await generateContent(outputTitle);
    console.log(`Output content is:`, outputContent);


    const slug = outputTitle.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, "-");
    console.log(`Slug is ${slug}`);

    // Save the blog post to the front-end repository
    const filePath = `posts/${slug}.md`;

    // Generate an excerpt (optional)
    const excerpt = 'Your generated excerpt goes here';

    // Set a cover image path (optional)
    const coverImagePath = '/assets/blog/dynamic-routing/cover.jpg';

    // Create a Markdown string with the required keys and values
    const markdownString = `---
title: "${outputTitle}"
excerpt: "${excerpt}"
coverImage: "${coverImagePath}"
date: "${new Date().toISOString()}"
ogImage:
  url: "${coverImagePath}"
---

${outputContent}
`;

    await saveBlogPost(filePath, markdownString);

    console.log(`Successfully created/updated ${slug}.md in the ${repoName} repository.`);

  } catch (error) {
    console.error('Error while generating and saving the blog post:', error);
  }
}


// Call the function immediately when the server starts
generateAndSaveBlogPost();

// Set the daily cron job to run at 12 PM GMT
cron.schedule('0 12 * * *', generateAndSaveBlogPost);

// Start the Express server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});