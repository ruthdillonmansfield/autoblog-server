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

const topics = ["ethics", "metaphysics", "epistemology", "aesthetics", "philosophical logic", "ontology", "metametaphysics", "philosophy of science", "philosophy of religion", "philosophy of language", "philosophy of mind", "philosophy of technology", "ancient philosophy", "bioethics", "philosophy of mathematics", "philosophy of law", "philosophy of time", "philosophy of substance", "modality"]

const approaches = [
  "Create a beginner's guide to a specific area within this topic.",
  "Create a beginner's guide to a specific area within this topic.",
  "Create a beginner's guide to a specific area within this topic.",
  "Examine a specific argument within this philosophical topic.",
  "Analyze the views of a particular philosopher on this topic.",
  "Discuss the historical development of this philosophical school of thought.",
  "Debate the validity of opposing perspectives on this issue.",
  "Compare and contrast the key concepts of different philosophical theories.",
  "Evaluate the implications of a specific philosophical idea within this topic on other disciplines.",
  "Explain the significance of a specific thought experiment within this topic.",
  "Critique the strengths and weaknesses of a particular philosophical argument."
];

const app = express();
app.use(cors());


app.get('/generate', async (req, res) => {
  try {
    await generateAndSaveBlogPost();
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

async function generateTitle() {
  const randomIndex = Math.floor(Math.random() * topics.length);
  const topic = topics[randomIndex];
  const randomIndex2 = Math.floor(Math.random() * approaches.length);
  const approach = approaches[randomIndex2];

  const promptContents = `Generate a unique, specific and compelling blog title on a subtopic within the broad topic of ${topic}. ${approach}. It should be 6-10 words long.`;  
  console.log(promptContents);
  
  const openAITitleResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: promptContents,
    temperature: 0.9,
    max_tokens: 40,
    top_p: 1.0,
  });
  const generatedText = openAITitleResponse.data.choices[0].text.trim();
  const cleanTitle = generatedText.replace(/["]/g, '');
  const firstSentence = cleanTitle.match(/^.*?[\.?]\s/)?.[0] ?? cleanTitle;
  return firstSentence;
}


async function generateDallePrompt(title) {
  const openAIPromptResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: `I want to create a fantastic image for a blog post called ${title}. Your job is to imagine a simple, relevant image and describe it in less than 10 words.`,
    temperature: 0.7,
    max_tokens: 30,
    top_p: 1.0,
  });

  return openAIPromptResponse.data.choices[0].text.trim();
}

function generateExcerpt(content) {
  // Remove headings
  const contentWithoutHeadings = content.replace(/^#+.+\n/gm, '');

  // Match the first two sentences
  const sentencesMatch = contentWithoutHeadings.match(/(?:^|(?<=[.?!]))\s*([^.?!]+[.?!])/g);

  if (sentencesMatch) {
    let excerpt = '';
    let sentenceCount = 0;
    for (const sentence of sentencesMatch) {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence) {
        excerpt += ' ' + trimmedSentence;
        sentenceCount++;
      }
      if (sentenceCount >= 2) {
        break;
      }
    }
    return excerpt.trim();
  }

  // Return an empty string if no sentences found
  return '';
}


async function generateImage(prompt) {
  const openAIPromptResponse = await openai.createImage({
    prompt: `Oil painting of ${prompt}`,
    n: 1,
    // size: "1024x1024",
    size: "512x512"
    // size: "256x256"
  });
  console.log("created image");
  return openAIPromptResponse.data.data[0].url;
}

async function downloadImageToBase64(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const base64 = Buffer.from(response.data, 'binary').toString('base64');
  return base64;
}

async function generateImageAndDownload(outputDallePrompt, imagePath) {
  const outputImage = await generateImage(outputDallePrompt);
  const imageBase64 = await downloadImageToBase64(outputImage);
  console.log("Downloaded image");
  await saveImage(imagePath, imageBase64)
  console.log("Saved image");
  return imageBase64;
}

async function generateContent(title) {
  const promptContents = `Now write a compelling blog, structured with markdown, and including h2 and h3 and paragraphs. The blog must be based on this title: ${title}, a technical topic in philosophy. Don't be afraid to offer different points of view and opinions.`;

  const openaiContentsResponse = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: promptContents,
    temperature: 0.7,
    max_tokens: 1500,
    top_p: 1.0,
  });

  const contentWithH1 = openaiContentsResponse.data.choices[0].text;
  const contentWithoutH1 = contentWithH1.replace(/^#\s.*$/gm, '').trim();
  console.log("created content: ", contentWithoutH1);
  return contentWithoutH1;
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

    const outputTitle = await generateTitle();
    console.log(`\nOutput title is ${outputTitle}`);
    
    const outputDallePrompt = await generateDallePrompt(outputTitle);
    console.log(`\nOutput DALL-E prompt is ${outputDallePrompt}\n`);

    const slug = outputTitle.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, "-");
    console.log(`\nSlug is ${slug}`);
    
    // Save the blog post to the front-end repository
    const filePath = `posts/${slug}.md`;
    
    // Save the image to the /assets/blog/ folder with the slug
    const imagePath = `assets/blog/${slug}.png`;

    const [outputImage, outputContent] = await Promise.all([
      generateImageAndDownload(outputDallePrompt, imagePath),
      generateContent(outputTitle),
    ]);
    console.log(outputContent);

    const excerpt = generateExcerpt(outputContent);
    console.log(`\nGenerated excerpt is:`, excerpt);

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

    await saveBlogPost(filePath, markdownString)

    console.log(`Successfully created/updated ${slug}.md in the ${repoName} repository.`);

  } catch (error) {
    console.error('Error while generating and saving the blog post:', error);
  }
}

// Call the function immediately when the server starts
// generateAndSaveBlogPost();

// Set the cron job to run at 9 AM GMT every 2 days
// cron.schedule('0 9 */2 * *', generateAndSaveBlogPost);
// cron.schedule('0 9 * * *', generateAndSaveBlogPost);

// Start the Express server
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});