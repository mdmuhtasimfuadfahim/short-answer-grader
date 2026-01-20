/**
 * Submission model for student answers and grades
 */
const mongoose = require('mongoose');

const dimensionScoreSchema = new mongoose.Schema({
    dimensionId: {
        type: mongoose.Schema.Types.ObjectId
    },
    dimensionName: {
        type: String,
        required: true
    },
    score: {
        type: Number,
        required: true,
        min: 0,
        max: 1
    },
    scaledScore: {
        type: Number
    },
    confidence: {
        type: Number,
        min: 0,
        max: 1
    },
    highlights: [{
        text: String,
        score: Number,
        charStart: Number,
        charEnd: Number
    }],
    feedback: {
        type: String
    }
}, { _id: false });

const submissionSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    question: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question',
        required: true
    },
    answerText: {
        type: String,
        required: [true, 'Answer text is required'],
        trim: true
    },
    overallScore: {
        type: Number,
        min: 0,
        max: 1
    },
    scaledOverallScore: {
        type: Number
    },
    dimensionScores: [dimensionScoreSchema],
    feedback: [{
        type: String
    }],
    status: {
        type: String,
        enum: ['pending', 'grading', 'graded', 'error', 'manual_review'],
        default: 'pending'
    },
    gradingMetadata: {
        model: String,
        modelVersion: String,
        timeMs: Number,
        gradedAt: Date
    },
    manualOverride: {
        overriddenBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        overriddenAt: Date,
        originalScore: Number,
        reason: String
    },
    attempts: {
        type: Number,
        default: 1
    },
    submittedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes
submissionSchema.index({ student: 1, question: 1 });
submissionSchema.index({ question: 1, status: 1 });
submissionSchema.index({ submittedAt: -1 });

// Virtual for percentage score
submissionSchema.virtual('percentageScore').get(function() {
    return this.overallScore ? Math.round(this.overallScore * 100) : null;
});

// Method to update with grading results
submissionSchema.methods.updateWithGradingResults = function(results) {
    this.overallScore = results.overall_score;
    this.scaledOverallScore = results.overall_score * (this.question?.maxScore || 100);
    
    this.dimensionScores = Object.entries(results.per_dimension).map(([name, data]) => ({
        dimensionName: name,
        score: data.score,
        confidence: data.confidence,
        highlights: data.highlights.map(h => ({
            text: h.text,
            score: h.score,
            charStart: h.char_start,
            charEnd: h.char_end
        }))
    }));
    
    this.feedback = results.feedback;
    this.gradingMetadata = {
        model: results.metadata.model,
        modelVersion: results.metadata.model_version,
        timeMs: results.metadata.time_ms,
        gradedAt: new Date()
    };
    this.status = 'graded';
};

module.exports = mongoose.model('Submission', submissionSchema);