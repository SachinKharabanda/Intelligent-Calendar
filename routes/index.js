var express = require('express');
var router = express.Router();

/* GET chat UI. */
router.get('/', function (req, res) {
  res.render('index', { title: 'Intelligent Calendar' });
});

module.exports = router;
