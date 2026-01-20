/**
 * Export all models
 */
const User = require('./User');
const Question = require('./Question');
const Rubric = require('./Rubric');
const Submission = require('./Submission');

module.exports = {
    User,
    Question,
    Rubric,
    Submission
};