const { Configuration, OpenAIApi } = require("openai");
const cron  = require('node-cron');
const express  = require('express');
const cors  = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
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

async function fetchLast15Files() {
  const listFilesResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: repoOwner,
    repo: repoName,
    path: 'posts',
    ref: branch,
  });

  return listFilesResponse.data.slice(-15);
}

async function fetchLast15Titles(last15Files) {
  const last15TitlesPromises = last15Files.map(async (file) => {
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

  return await Promise.all(last15TitlesPromises);
}


async function generateTitle(last15Titles) {
  const titlesList = last15Titles.join('\n');
  const promptContents = `Generate a unique and compelling blog title within the broad topic of "Science" that is not a repeat of any of the following specific topics covered in these blogs:\n\n${titlesList}\n\nNew title: `;
  console.log(promptContents);
  
  const openAITitleResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: promptContents,
    temperature: 0.8,
    max_tokens: 50, // Reduced max_tokens
    top_p: 1.0,
  });  
  const generatedText = openAITitleResponse.data.choices[0].text.trim();
  const title = generatedText.replace(/^New title: /, '').trim(); // Remove the 'New title:' prompt from the generated text
  return title;
}


async function generateDallePrompt(title) {
  const openAIPromptResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: `I want to create a fantastic image for a blog post. Your job is to write a prompt for image generation AI tool Dall-E that will create an image suitable for a blog entitled "${title}"`,
    temperature: 0.7,
    max_tokens: 30,
    top_p: 1.0,
  });

  return openAIPromptResponse.data.choices[0].text.trim();
}

async function generateImage(prompt) {
  const openAIPromptResponse = await openai.createImage({
    prompt: `Beautiful oil painting of ${prompt}`,
    n: 1,
    size: "1024x1024",
  });

  return openAIPromptResponse.data.data[0].url;
}

async function downloadImageToBase64(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const base64 = Buffer.from(response.data, 'binary').toString('base64');
  return base64;
}

async function generateContent(title) {
  const promptContents = `Now write 2-3 paragraphs of no more than 80 words, structured with markdown, and including headings and paragraphs. The blog must be based on this title: ${title}`;

  const openaiContentsResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: promptContents,
    temperature: 0.7,
    max_tokens: 300,
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

async function saveImage(filePath, base64EncodedContent) {
  let sha;

  filePath = `public/${filePath}`;

  try {
    const getFileResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: repoOwner,
      repo: repoName,
      path: filePath,
      ref: branch,
    });

    sha = getFileResponse.data.sha;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  const createOrUpdateImageRequest = {
    owner: repoOwner,
    repo: repoName,
    path: filePath,
    message: `Add new image for blog post`,
    content: base64EncodedContent,
    branch: branch,
  };

  if (sha) {
    createOrUpdateImageRequest.sha = sha;
  }

  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', createOrUpdateImageRequest);
}


async function generateAndSaveBlogPost() {
  try {
    const last15Files = await fetchLast15Files();
    console.log("Fetched 15 files.");

    const last15Titles = await fetchLast15Titles(last15Files);
    console.log("Fetched 15 titles: ", last15Titles);

    const outputTitle = await generateTitle(last15Titles);
    console.log(`Output title is ${outputTitle}`);

    const outputDallePrompt = await generateDallePrompt(outputTitle);
    console.log(`Output DALL-E prompt is ${outputDallePrompt}`);

    const outputImage = await generateImage(outputDallePrompt);
    console.log(`Created DALL-E image`);
    
    const outputContent = await generateContent(outputTitle);
    console.log(`Output content is:`, outputContent);

    const slug = outputTitle.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, "-");
    console.log(`Slug is ${slug}`);

    // Save the blog post to the front-end repository
    const filePath = `posts/${slug}.md`;

    // Generate an excerpt (optional)
    const excerpt = 'Your generated excerpt goes here';

    // Download the image as a base64 encoded string
    const imageBase64 = await downloadImageToBase64(outputImage);

    // Save the image to the /assets/blog/ folder with the slug
    const imagePath = `assets/blog/${slug}.png`;
    await saveImage(imagePath, imageBase64);

    // Create a Markdown string with the required keys and values
    const markdownString = `---
title: "${outputTitle}"
excerpt: "${excerpt}"
coverImage: "/${imagePath}"
date: "${new Date().toISOString()}"
ogImage:
  url: "/${imagePath}"
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