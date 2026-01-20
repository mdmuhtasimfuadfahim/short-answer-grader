import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { questionsAPI, gradingAPI } from '../api';

const StudentDashboard = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [questions, setQuestions] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('available');
    const [error, setError] = useState('');

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
            
            setQuestions(questionsRes.data.data);
            setSubmissions(submissionsRes.data.data);
        } catch (err) {
            console.error('Failed to fetch data:', err);
            setError('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    const handleStartAnswer = (questionId) => {
        navigate(`/submit/${questionId}`);
    };

    const handleViewResults = (submissionId) => {
        navigate(`/results/${submissionId}`);
    };

    if (loading) {
        return <div className="loading">Loading dashboard...</div>;
    }

    return (
        <div className="student-dashboard">
            <div className="dashboard-header">
                <h1>Welcome, {user?.name}</h1>
                <p>Student Dashboard</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="dashboard-tabs">
                <button
                    className={`tab ${activeTab === 'available' ? 'active' : ''}`}
                    onClick={() => setActiveTab('available')}
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

            {activeTab === 'available' && (
                <div className="questions-list">
                    <h2>Available Questions</h2>
                    {questions.length === 0 ? (
                        <p>No questions available at the moment.</p>
                    ) : (
                        <div className="questions-grid">
                            {questions.map((question) => (
                                <div key={question._id} className="question-card">
                                    <h3>{question.title}</h3>
                                    {question.subject && <p><strong>Subject:</strong> {question.subject}</p>}
                                    {question.topic && <p><strong>Topic:</strong> {question.topic}</p>}
                                    <p><strong>Max Score:</strong> {question.maxScore}</p>
                                    {question.dueDate && (
                                        <p><strong>Due:</strong> {new Date(question.dueDate).toLocaleDateString()}</p>
                                    )}
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handleStartAnswer(question._id)}
                                    >
                                        Start Answer
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'submissions' && (
                <div className="submissions-list">
                    <h2>My Submissions</h2>
                    {submissions.length === 0 ? (
                        <p>You haven't submitted any answers yet.</p>
                    ) : (
                        <div className="submissions-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Question</th>
                                        <th>Status</th>
                                        <th>Score</th>
                                        <th>Submitted</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {submissions.map((submission) => (
                                        <tr key={submission._id}>
                                            <td>{submission.question?.title || 'N/A'}</td>
                                            <td>
                                                <span className={`status-badge status-${submission.status}`}>
                                                    {submission.status}
                                                </span>
                                            </td>
                                            <td>
                                                {submission.totalScore !== undefined
                                                    ? `${submission.totalScore}/${submission.question?.maxScore || 100}`
                                                    : 'Pending'}
                                            </td>
                                            <td>{new Date(submission.createdAt).toLocaleDateString()}</td>
                                            <td>
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => handleViewResults(submission._id)}
                                                >
                                                    View Results
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StudentDashboard;