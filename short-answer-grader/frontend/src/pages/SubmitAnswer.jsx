import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { questionsAPI, gradingAPI } from '../api';

const SubmitAnswer = () => {
    const { questionId } = useParams();
    const navigate = useNavigate();
    
    const [question, setQuestion] = useState(null);
    const [answerText, setAnswerText] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [gradingStatus, setGradingStatus] = useState('');

    useEffect(() => {
        fetchQuestion();
    }, [questionId]);

    const fetchQuestion = async () => {
        try {
            setLoading(true);
            const res = await questionsAPI.getById(questionId);
            setQuestion(res.data.data);
        } catch (err) {
            setError('Failed to load question. It may not exist or is no longer available.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!answerText.trim()) {
            setError('Please enter your answer');
            return;
        }

        if (answerText.trim().split(/\s+/).length < 5) {
            setError('Your answer is too short. Please provide a more detailed response.');
            return;
        }

        setSubmitting(true);
        setError('');
        setGradingStatus('Submitting your answer...');

        try {
            setGradingStatus('Your answer is being graded by AI. This may take a few seconds...');
            
            const res = await gradingAPI.submitAnswer({
                questionId,
                answerText: answerText.trim()  // Changed from 'answer' to 'answerText'
            });
            
            const submission = res.data.data;
            
            if (submission.status === 'graded') {
                setGradingStatus('Grading complete! Redirecting to results...');
                setTimeout(() => {
                    navigate(`/results/${submission._id}`);
                }, 1000);
            } else if (submission.status === 'error') {
                setError('Grading failed. Please try again later.');
                setSubmitting(false);
                setGradingStatus('');
            } else {
                // Still processing
                setGradingStatus('Grading in progress...');
                navigate(`/results/${submission._id}`);
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to submit answer. Please try again.');
            setSubmitting(false);
            setGradingStatus('');
        }
    };

    const wordCount = answerText.trim().split(/\s+/).filter(Boolean).length;
    const charCount = answerText.length;

    if (loading) {
        return (
            <div className="submit-answer-page">
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading question...</p>
                </div>
            </div>
        );
    }

    if (!question) {
        return (
            <div className="submit-answer-page">
                <div className="error-state">
                    <h2>Question Not Found</h2>
                    <p>{error || 'The requested question could not be found.'}</p>
                    <button onClick={() => navigate('/student')} className="btn btn-primary">
                        Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="submit-answer-page">
            <div className="question-details card">
                <div className="question-header">
                    <h1>{question.title}</h1>
                    <div className="question-badges">
                        {question.subject && (
                            <span className="badge badge-subject">{question.subject}</span>
                        )}
                        {question.topic && (
                            <span className="badge badge-topic">{question.topic}</span>
                        )}
                        {question.difficulty && (
                            <span className={`badge badge-difficulty difficulty-${question.difficulty}`}>
                                {question.difficulty}
                            </span>
                        )}
                    </div>
                </div>

                <div className="question-content">
                    <h3>Question:</h3>
                    <p className="question-text">{question.content}</p>
                </div>

                <div className="question-meta">
                    <div className="meta-item">
                        <span className="meta-label">Maximum Score:</span>
                        <span className="meta-value">{question.maxScore} points</span>
                    </div>
                    {question.dueDate && (
                        <div className="meta-item">
                            <span className="meta-label">Due Date:</span>
                            <span className="meta-value">
                                {new Date(question.dueDate).toLocaleDateString()}
                            </span>
                        </div>
                    )}
                </div>

                {question.rubric && (
                    <div className="rubric-info">
                        <h4>Grading Criteria:</h4>
                        <p>Your answer will be evaluated on {question.rubric.dimensions?.length || 0} dimensions:</p>
                        <ul className="criteria-list">
                            {question.rubric.dimensions?.map((dim, idx) => (
                                <li key={idx}>
                                    <strong>{dim.name}</strong>
                                    {dim.weight && <span className="weight"> ({(dim.weight * 100).toFixed(0)}%)</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit} className="answer-form card">
                <div className="form-group">
                    <label htmlFor="answer">
                        Your Answer
                        <span className="required">*</span>
                    </label>
                    <textarea
                        id="answer"
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value)}
                        rows={12}
                        placeholder="Type your answer here. Be thorough and address all aspects of the question..."
                        disabled={submitting}
                        className={submitting ? 'disabled' : ''}
                    />
                    <div className="textarea-info">
                        <span className={wordCount < 10 ? 'warning' : ''}>
                            Words: {wordCount}
                        </span>
                        <span>Characters: {charCount}</span>
                    </div>
                </div>

                <div className="form-tips">
                    <h4>Tips for a good answer:</h4>
                    <ul>
                        <li>Address all parts of the question</li>
                        <li>Use relevant terminology and concepts</li>
                        <li>Provide specific examples where appropriate</li>
                        <li>Explain your reasoning clearly</li>
                    </ul>
                </div>

                <div className="form-actions">
                    <button 
                        type="button"
                        onClick={() => navigate('/student')}
                        className="btn btn-secondary"
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit"
                        className="btn btn-primary btn-submit"
                        disabled={submitting || !answerText.trim()}
                    >
                        {submitting ? 'Submitting...' : 'Submit Answer'}
                    </button>
                </div>
            </form>

            {submitting && (
                <div className="grading-overlay">
                    <div className="grading-indicator">
                        <div className="spinner large"></div>
                        <h3>Processing Your Submission</h3>
                        <p>{gradingStatus}</p>
                        <div className="grading-steps">
                            <div className={`step ${gradingStatus.includes('Submitting') ? 'active' : 'done'}`}>
                                <span className="step-icon">1</span>
                                <span className="step-text">Submitting</span>
                            </div>
                            <div className={`step ${gradingStatus.includes('graded') ? 'active' : ''}`}>
                                <span className="step-icon">2</span>
                                <span className="step-text">AI Grading</span>
                            </div>
                            <div className={`step ${gradingStatus.includes('complete') ? 'active' : ''}`}>
                                <span className="step-icon">3</span>
                                <span className="step-text">Complete</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubmitAnswer;