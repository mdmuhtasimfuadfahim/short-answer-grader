import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { gradingAPI } from '../api';
import ScoreBreakdown from '../components/ScoreBreakdown';
import FeedbackCard from '../components/FeedbackCard';
import HighlightedText from '../components/HighlightedText';

const ViewResults = () => {
    const { submissionId } = useParams();
    const navigate = useNavigate();
    
    const [submission, setSubmission] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showOverrideForm, setShowOverrideForm] = useState(false);
    const [overrideScore, setOverrideScore] = useState('');
    const [overrideReason, setOverrideReason] = useState('');
    const [overriding, setOverriding] = useState(false);

    useEffect(() => {
        fetchSubmission();
    }, [submissionId]);

    const fetchSubmission = async () => {
        try {
            setLoading(true);
            const res = await gradingAPI.getSubmission(submissionId);
            setSubmission(res.data.data);
            if (res.data.data.overriddenScore !== undefined) {
                setOverrideScore(res.data.data.overriddenScore.toString());
            }
        } catch (err) {
            setError('Failed to load submission results');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleOverride = async (e) => {
        e.preventDefault();
        
        const score = parseFloat(overrideScore);
        if (isNaN(score) || score < 0 || score > 1) {
            alert('Please enter a valid score between 0 and 1');
            return;
        }

        setOverriding(true);
        try {
            await gradingAPI.override(submissionId, {
                overriddenScore: score,
                overrideReason: overrideReason
            });
            await fetchSubmission();
            setShowOverrideForm(false);
        } catch (err) {
            alert('Failed to override score');
        } finally {
            setOverriding(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString();
    };

    const getStatusClass = (status) => {
        const statusClasses = {
            'pending': 'status-pending',
            'grading': 'status-grading',
            'graded': 'status-graded',
            'error': 'status-error',
            'manual_review': 'status-manual_review'
        };
        return statusClasses[status] || 'status-pending';
    };

    const getFinalScore = () => {
        if (submission?.overriddenScore !== undefined && submission?.overriddenScore !== null) {
            return submission.overriddenScore;
        }
        return submission?.gradingResult?.overall_score || 0;
    };

    const getScorePercentage = () => {
        return (getFinalScore() * 100).toFixed(1);
    };

    const getScoreClass = () => {
        const score = getFinalScore();
        if (score >= 0.8) return 'score-excellent';
        if (score >= 0.6) return 'score-good';
        if (score >= 0.4) return 'score-partial';
        return 'score-needs-improvement';
    };

    // Collect all highlight spans from all dimensions
    const getAllHighlights = () => {
        if (!submission?.gradingResult?.per_dimension) return [];
        
        const highlights = [];
        Object.entries(submission.gradingResult.per_dimension).forEach(([dimName, dimData]) => {
            if (dimData.highlights) {
                dimData.highlights.forEach(h => {
                    highlights.push({
                        ...h,
                        dimension: dimName,
                        type: h.score > 0.5 ? 'positive' : 'neutral'
                    });
                });
            }
        });
        return highlights;
    };

    if (loading) {
        return (
            <div className="view-results-page">
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading results...</p>
                </div>
            </div>
        );
    }

    if (error || !submission) {
        return (
            <div className="view-results-page">
                <div className="error-state">
                    <h2>Error Loading Results</h2>
                    <p>{error || 'Submission not found'}</p>
                    <button onClick={() => navigate(-1)} className="btn btn-primary">
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    const gradingResult = submission.gradingResult || {};
    const question = submission.question || {};
    const highlights = getAllHighlights();

    return (
        <div className="view-results-page">
            <div className="results-header">
                <div>
                    <h1>Grading Results</h1>
                    <p className="question-title">
                        {question.title || 'Untitled Question'}
                    </p>
                </div>
                <button onClick={() => navigate(-1)} className="btn btn-secondary">
                    ← Back
                </button>
            </div>

            {/* Status Bar */}
            <div className="status-section">
                <span className="status-label">Status:</span>
                <span className={`status-badge ${getStatusClass(submission.status)}`}>
                    {submission.status?.replace('_', ' ').toUpperCase()}
                </span>
                {submission.gradedAt && (
                    <span className="graded-date">
                        Graded: {formatDate(submission.gradedAt)}
                    </span>
                )}
            </div>

            {submission.status === 'graded' || submission.status === 'manual_review' ? (
                <div className="results-content">
                    <div className="results-main">
                        {/* Score Breakdown */}
                        <ScoreBreakdown
                            overallScore={getFinalScore()}
                            perDimension={gradingResult.per_dimension || {}}
                            maxScore={question.maxScore || 1}
                            isOverridden={submission.overriddenScore !== undefined && submission.overriddenScore !== null}
                        />

                        {/* Override Notice */}
                        {submission.overriddenScore !== undefined && submission.overriddenScore !== null && (
                            <div className="override-notice card">
                                <h4>⚠️ Score Manually Overridden</h4>
                                <p>
                                    Original AI Score: {((gradingResult.overall_score || 0) * 100).toFixed(1)}%
                                </p>
                                <p>
                                    Overridden Score: {(submission.overriddenScore * 100).toFixed(1)}%
                                </p>
                                {submission.overrideReason && (
                                    <p><strong>Reason:</strong> {submission.overrideReason}</p>
                                )}
                                <small>
                                    Overridden by: {submission.overriddenBy?.name || 'Teacher'} on {formatDate(submission.overriddenAt)}
                                </small>
                            </div>
                        )}

                        {/* Student Answer with Highlights */}
                        <div className="answer-section card">
                            <h3>Your Answer</h3>
                            <div className="answer-text highlighted">
                                <HighlightedText
                                    text={submission.answerText}
                                    highlights={highlights}
                                />
                            </div>
                            <div className="answer-meta">
                                <span>Word count: {submission.answerText?.split(/\s+/).filter(Boolean).length || 0}</span>
                                <span>Submitted: {formatDate(submission.submittedAt)}</span>
                            </div>
                        </div>

                        {/* Feedback */}
                        <FeedbackCard
                            feedback={gradingResult.feedback || []}
                            perDimension={gradingResult.per_dimension || {}}
                        />
                    </div>

                    <div className="results-sidebar">
                        {/* Quick Score Card */}
                        <div className={`quick-score-card card ${getScoreClass()}`}>
                            <div className="score-display">
                                <span className="score-value">{getScorePercentage()}%</span>
                                <span className="score-label">Overall Score</span>
                            </div>
                            {question.maxScore && question.maxScore !== 1 && (
                                <div className="points-display">
                                    {(getFinalScore() * question.maxScore).toFixed(1)} / {question.maxScore} points
                                </div>
                            )}
                        </div>

                        {/* Metadata */}
                        <div className="metadata-card card">
                            <h4>Submission Details</h4>
                            <ul>
                                <li>
                                    <span>Submitted</span>
                                    <span>{formatDate(submission.submittedAt)}</span>
                                </li>
                                <li>
                                    <span>Graded</span>
                                    <span>{formatDate(submission.gradedAt)}</span>
                                </li>
                                <li>
                                    <span>Model</span>
                                    <span>{gradingResult.metadata?.model || 'N/A'}</span>
                                </li>
                                <li>
                                    <span>Processing Time</span>
                                    <span>{gradingResult.metadata?.time_ms ? `${gradingResult.metadata.time_ms}ms` : 'N/A'}</span>
                                </li>
                            </ul>
                        </div>

                        {/* Question Info */}
                        {question.content && (
                            <div className="question-card card">
                                <h4>Question</h4>
                                <p className="question-text-small">{question.content}</p>
                                {question.subject && (
                                    <span className="badge badge-subject">{question.subject}</span>
                                )}
                            </div>
                        )}

                        {/* Teacher Actions */}
                        {submission.canOverride && (
                            <div className="actions-card card">
                                <h4>Teacher Actions</h4>
                                {!showOverrideForm ? (
                                    <button
                                        onClick={() => setShowOverrideForm(true)}
                                        className="btn btn-secondary btn-block"
                                    >
                                        Override Score
                                    </button>
                                ) : (
                                    <form onSubmit={handleOverride} className="override-form">
                                        <div className="form-group">
                                            <label>New Score (0-1)</label>
                                            <input
                                                type="number"
                                                value={overrideScore}
                                                onChange={(e) => setOverrideScore(e.target.value)}
                                                min="0"
                                                max="1"
                                                step="0.01"
                                                required
                                                placeholder="e.g., 0.85"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Reason (optional)</label>
                                            <textarea
                                                value={overrideReason}
                                                onChange={(e) => setOverrideReason(e.target.value)}
                                                rows={2}
                                                placeholder="Why are you changing the score?"
                                            />
                                        </div>
                                        <div className="form-actions">
                                            <button
                                                type="button"
                                                onClick={() => setShowOverrideForm(false)}
                                                className="btn btn-sm btn-secondary"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                className="btn btn-sm btn-primary"
                                                disabled={overriding}
                                            >
                                                {overriding ? 'Saving...' : 'Save'}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ) : submission.status === 'pending' || submission.status === 'grading' ? (
                <div className="grading-in-progress card">
                    <div className="spinner large"></div>
                    <h2>Grading in Progress</h2>
                    <p>Your answer is being evaluated by AI. This usually takes a few seconds.</p>
                    <button onClick={fetchSubmission} className="btn btn-primary">
                        Refresh Status
                    </button>
                </div>
            ) : (
                <div className="grading-error card">
                    <h2>Grading Error</h2>
                    <p>There was an error grading your submission. Please contact your instructor.</p>
                    {submission.errorMessage && (
                        <p className="error-details">{submission.errorMessage}</p>
                    )}
                    <Link to="/student" className="btn btn-primary">
                        Back to Dashboard
                    </Link>
                </div>
            )}
        </div>
    );
};

export default ViewResults;