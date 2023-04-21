const OpenAI = require('openai');
const cron  = require('node-cron');
const express  = require('express');
const cors  = require('cors');
const fs  = require('fs');

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

app.use(cors());
app.use('/blogs', express.static('blogs'));

// Define route to retrieve all blog posts
app.get('/blog-posts', (req, res) => {
  try {
    // Get the contents of all JSON files in the blogs directory
    const files = fs.readdirSync('blogs');
    const blogPosts = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const fileContents = fs.readFileSync(`blogs/${file}`);
        return JSON.parse(fileContents);
      });
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
app.get('/blog-posts/:id', (req, res) => {
  const id = req.params.id;
  try {
    // Get the contents of the blog post file
    const fileContents = fs.readFileSync(`blogs/${id}.json`);
    const blogPost = JSON.parse(fileContents);

    // Send the blog post as a response
    res.json(blogPost);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).send('Blog post not found.');
    } else {
      console.error(error);
      res.status(500).send('Internal server error.');
    }
  }
});

app.get('*', (req, res) => {
  res.send('OK');
});

// Start the server
app.listen(3000, () => {
  console.log('Server started on port 3000.');
});