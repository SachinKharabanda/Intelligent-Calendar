var express = require('express');
var router = express.Router();

// TODO: receive a user request -> parse -> policy decides ASK or ACT -> respond
router.post('/', function (req, res) { res.sendStatus(501); });
// TODO: receive the user's reply to a clarifying question and resume
router.post('/reply', function (req, res) { res.sendStatus(501); });

module.exports = router;
