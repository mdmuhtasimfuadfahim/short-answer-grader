import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { questionsAPI, gradingAPI } from '../api';
import { useAuth } from '../context/AuthContext';

const StudentDashboard = () => {
    const { user } = useAuth();
    const [questions, setQuestions] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState('questions');

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [questionsRes, submissionsRes] = await Promise.all([
                questionsAPI.getAll(),
                gradingAPI.getMySubmissions()
            ]);
            setQuestions(questionsRes.data.data || []);
            setSubmissions(submissionsRes.data.data || []);
        } catch (err) {
            setError('Failed to load data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const getSubmissionForQuestion = (questionId) => {
        return submissions.find(s => s.question?._id === questionId || s.question === questionId);
    };

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    return (
        <div className="dashboard student-dashboard">
            <div className="dashboard-header">
                <h1>Welcome, {user.name}</h1>
                <p>Student Dashboard</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="tabs">
                <button 
                    className={`tab ${activeTab === 'questions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('questions')}
                >
                    Available Questions
                </button>
                <button 
                    className={`tab ${activeTab === 'submissions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('submissions')}
                >
                    My Submissions
                </button>
            </div>

            {activeTab === 'questions' && (
                <div className="questions-list">
                    {questions.length === 0 ? (
                        <p className="empty-state">No questions available</p>
                    ) : (
                        questions.map(question => {
                            const submission = getSubmissionForQuestion(question._id);
                            return (
                                <div key={question._id} className="question-card">
                                    <div className="question-info">
                                        <h3>{question.title}</h3>
                                        <p className="question-meta">
                                            {question.subject && <span>Subject: {question.subject}</span>}
                                            {question.topic && <span>Topic: {question.topic}</span>}
                                            <span>Max Score: {question.maxScore}</span>
                                        </p>
                                    </div>
                                    <div className="question-actions">
                                        {submission ? (
                                            <>
                                                <span className={`status-badge status-${submission.status}`}>
                                                    {submission.status}
                                                </span>
                                                {submission.status === 'graded' && (
                                                    <span className="score-badge">
                                                        {(submission.overallScore * 100).toFixed(0)}%
                                                    </span>
                                                )}
                                                <Link 
                                                    to={`/results/${submission._id}`}
                                                    className="btn btn-secondary"
                                                >
                                                    View Results
                                                </Link>
                                            </>
                                        ) : (
                                            <Link 
                                                to={`/submit/${question._id}`}
                                                className="btn btn-primary"
                                            >
                                                Submit Answer
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {activeTab === 'submissions' && (
                <div className="submissions-list">
                    {submissions.length === 0 ? (
                        <p className="empty-state">No submissions yet</p>
                    ) : (
                        submissions.map(submission => (
                            <div key={submission._id} className="submission-card">
                                <div className="submission-info">
                                    <h3>{submission.question?.title || 'Question'}</h3>
                                    <p>Submitted: {new Date(submission.submittedAt).toLocaleDateString()}</p>
                                    <span className={`status-badge status-${submission.status}`}>
                                        {submission.status}
                                    </span>
                                </div>
                                <div className="submission-score">
                                    {submission.status === 'graded' && (
                                        <span className="score">
                                            {(submission.overallScore * 100).toFixed(0)}%
                                        </span>
                                    )}
                                    <Link 
                                        to={`/results/${submission._id}`}
                                        className="btn btn-secondary"
                                    >
                                        View Details
                                    </Link>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default StudentDashboard;