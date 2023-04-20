const OpenAI = require('openai');
const cron  = require('node-cron');
const express  = require('express');


const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({
    auth: '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',
    userAgent: 'autoBlog v1.0.0',
});

// Define function to generate and save a new blog post
const generateBlogPost = async () => {
  try {
    // Get the last 20 blog posts from GitHub
    const { data } = await octokit.repos.getContent({
      owner: 'ruthdillonmansfield',
      repo: 'autoblog-contents',
    //   path: '/',
    });
    const blogPosts = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')).slice(0, 20);
    const prompts = blogPosts.map((post) => post.topic);

    // Use the OpenAI API to generate a new unique blog post based on the last 20 blog post topics
    const response = await OpenAI.completions.create({
      model: 'text-davinci-002',
      prompt: `Here are the last 20 blog posts:\n\n${prompts.join('\n')}\n\nWrite a new blog post that is unique and interesting.`,
      maxTokens: 1024,
      n: 1,
    });

    // Save the generated blog post to GitHub
    const newBlogPost = {
      topic: response.choices[0].text,
      content: response.choices[0].text,
      created_at: new Date().toISOString(),
    };
    blogPosts.unshift(newBlogPost);
    const fileContent = JSON.stringify(blogPosts, null, 2);
    await octokit.repos.createOrUpdateFileContents({
      owner: 'your-username',
      repo: 'your-repository',
      path: '/',
      message: 'Add new blog post',
      content: Buffer.from(fileContent).toString('base64'),
      sha: data.sha,
    });

    console.log('Blog post generated successfully.');
  } catch (error) {
    console.error(error);
  }
};

// Schedule the generateBlogPost function to run every day at 12:00 AM
cron.schedule('0 0 * * *', () => {
  generateBlogPost('Artificial Intelligence');
});

// Create Express app
const app = express();

// Define route to retrieve all blog posts
app.get('/blog-posts', async (req, res) => {
    try {
      // Get all blog post file names from GitHub
      const { data } = await octokit.repos.getContent({
        owner: 'ruthdillonmansfield',
        repo: 'autoblog-contents',
      });
  
      // Filter out any non-JSON files and get their contents
      const promises = data.filter((file) => file.name.endsWith('.json')).map(async (file) => {
        const { data } = await octokit.repos.getContent({
          owner: 'ruthdillonmansfield',
          repo: 'autoblog-contents',
          path: file.path,
        })
  
        // Parse the contents of the file as JSON
        const blogPost = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  
        return blogPost;
      });
  
      // Wait for all promises to resolve and combine the results into a single array
      const blogPosts = await Promise.all(promises);
  
      if (blogPosts.length > 0) {
        res.json(blogPosts);
      } else {
        res.status(404).send('No blog posts found.');
      }
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal server error.');
    }
});
  
  
// Define route to retrieve a specific blog post by ID
app.get('/blog-posts/:id', async (req, res) => {
    const id = req.params.id;
    try {
      // Get the contents of the blog post file
      const { data } = await octokit.repos.getContent({
        owner: 'ruthdillonmansfield',
        repo: 'autoblog-contents',
        path: `${id}.json`,
      });
      const fileContents = Buffer.from(data.content, 'base64').toString('utf8');
  
      // Parse the contents of the file as JSON
      const blogPost = JSON.parse(fileContents);
  
      // Send the blog post as a response
      res.json(blogPost);
    } catch (error) {
      if (error.status === 404) {
        res.status(404).send('Blog post not found.');
      } else {
        console.error(error);
        res.status(500).send('Internal server error.');
      }
    }
});
  

// Start the server
app.listen(3000, () => {
  console.log('Server started on port 3000.');
});
