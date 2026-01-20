/**
 * Question model with reference answers
 */
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Question title is required'],
        trim: true,
        maxlength: [500, 'Title cannot exceed 500 characters']
    },
    content: {
        type: String,
        required: [true, 'Question content is required'],
        trim: true
    },
    referenceAnswer: {
        type: String,
        required: [true, 'Reference answer is required'],
        trim: true
    },
    maxScore: {
        type: Number,
        default: 100,
        min: [1, 'Max score must be at least 1']
    },
    subject: {
        type: String,
        trim: true
    },
    topic: {
        type: String,
        trim: true
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rubric: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Rubric'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    dueDate: {
        type: Date
    },
    tags: [{
        type: String,
        trim: true
    }]
}, {
    timestamps: true
});

// Indexes
questionSchema.index({ createdBy: 1 });
questionSchema.index({ subject: 1, topic: 1 });
questionSchema.index({ createdAt: -1 });

// Virtual for submission count
questionSchema.virtual('submissionCount', {
    ref: 'Submission',
    localField: '_id',
    foreignField: 'question',
    count: true
});

module.exports = mongoose.model('Question', questionSchema);