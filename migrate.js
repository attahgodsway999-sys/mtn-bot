require('dotenv').config();
const { migrate } = require('./database');
migrate();
