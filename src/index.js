require('dotenv').config();
const express = require('express');
const cors = require('cors');
const angkotRoutes = require('./routes/angkot.js');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'AngkotMedan API is running' });
});

app.use('/api', angkotRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});