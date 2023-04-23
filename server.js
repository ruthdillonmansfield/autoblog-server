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
const repoName = 'autoblog_frontend';
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

async function generateAndSaveBlogPost() {
  try {
    // Fetch the last 20 blog titles from the front-end repository
    // Fetch the last 20 blog titles from the front-end repository
    const listFilesResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: repoOwner,
      repo: repoName,
      path: 'src/blogs',
      ref: branch,
    });

    const last20Files = listFilesResponse.data.slice(-20);

    // Fetch the content of each file and parse the JSON to get the titles
    const last20TitlesPromises = last20Files.map(async (file) => {
      const fileContentResponse = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: repoOwner,
        repo: repoName,
        path: file.path,
        ref: branch,
      });

      const fileContent = Buffer.from(fileContentResponse.data.content, 'base64').toString();
      const json = JSON.parse(fileContent);
      return json.title;
    });

    const last20Titles = await Promise.all(last20TitlesPromises);

    console.log(last20Titles);

    // Generate a unique blog post using the OpenAI API
    // const prompt = `Write a unique blog post about the same subject matter as the following 20 blog titles, but make sure it is different from them: ${last20Titles.join(', ')}\n\nTitle: {{title}}\nDate: {{date}}\nMeta Description: {{meta_description}}\nBlog Contents: {{blog_contents}}\n\nThe Blog Contents value should be an HTML string representing an insightful, well-written and confident blog structured with headings.`;

    const promptTitle = `Come up with one SEO-friendly blog title that is similar to these: ${last20Titles.join(', ')}`

    const openAITitleResponse = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: promptTitle,
      temperature: 0.9,
      max_tokens: 750,
      top_p: 1.0,
    });

    const outputTitle = openAITitleResponse.data.choices[0].text.replace(/^[\n\s"]+|[\n\s"]+$/g, '');

    console.log(outputTitle);


    const promptContents = `Now write 2-3 paragraphs of no more than 80 words, structured with HTML, and including headings and paragraphs. The blog must be based on this title: ${outputTitle}`;

    const openaiContentsResponse = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: promptContents,
      temperature: 0.7,
      max_tokens: 750,
      top_p: 1.0,
    });

    // Extract JSON object from the generated text
    const outputContent = openaiContentsResponse.data.choices[0].text;

    console.log(outputContent);

// ... (previous code remains the same)

const slug = outputTitle.replace(/[^\w\s]|_/g, "").replace(/\s+/g, "-");

console.log(slug);

// Save the blog post to the front-end repository
const filePath = `src/blogs/${slug}.json`;

// Create a new object with the required keys and values
const blogPost = {
  title: outputTitle,
  date: new Date().toISOString(),
  tags: [], // You can add tags here if required
  category: "", // You can add a category here if required
  contents: outputContent
};

// Convert the object to a JSON string
const jsonString = JSON.stringify(blogPost, null, 2);

// Base64-encode the JSON string
const base64EncodedContent = Buffer.from(jsonString).toString('base64');

const createOrUpdateFileResponse = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
  owner: repoOwner,
  repo: repoName,
  path: filePath,
  message: `Add new blog post: ${outputTitle}`,
  content: base64EncodedContent,
  branch: branch,
});

console.log(`Successfully created/updated ${slug}.json in the ${repoName} repository.`);

// ... (rest of the code remains the same)


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