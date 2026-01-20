import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { questionsAPI, gradingAPI } from '../api';
import { useAuth } from '../context/AuthContext';

const TeacherDashboard = () => {
    const { user } = useAuth();
    const [questions, setQuestions] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [mlHealth, setMlHealth] = useState(null);

    useEffect(() => {
        fetchData();
        checkMLService();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const questionsRes = await questionsAPI.getAll();
            const questionsData = questionsRes.data.data || [];
            setQuestions(questionsData);

            // Fetch stats for each question
            const statsPromises = questionsData.map(q => 
                questionsAPI.getStats(q._id).catch(() => ({ data: { data: null } }))
            );
            const statsResults = await Promise.all(statsPromises);
            
            const statsMap = {};
            questionsData.forEach((q, idx) => {
                statsMap[q._id] = statsResults[idx].data.data;
            });
            setStats(statsMap);
        } catch (err) {
            setError('Failed to load data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const checkMLService = async () => {
        try {
            const res = await gradingAPI.checkHealth();
            setMlHealth(res.data.data);
        } catch (err) {
            setMlHealth({ healthy: false, error: 'Cannot connect' });
        }
    };

    const handleDeleteQuestion = async (id) => {
        if (!window.confirm('Are you sure you want to delete this question?')) return;
        
        try {
            await questionsAPI.delete(id);
            setQuestions(questions.filter(q => q._id !== id));
        } catch (err) {
            alert('Failed to delete question');
        }
    };

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    return (
        <div className="dashboard teacher-dashboard">
            <div className="dashboard-header">
                <h1>Welcome, {user.name}</h1>
                <p>Teacher Dashboard</p>
                
                <div className="ml-status">
                    ML Service: 
                    <span className={`status-indicator ${mlHealth?.healthy ? 'healthy' : 'unhealthy'}`}>
                        {mlHealth?.healthy ? '● Connected' : '○ Disconnected'}
                    </span>
                </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="dashboard-actions">
                <Link to="/questions/create" className="btn btn-primary">
                    + Create Question
                </Link>
                <Link to="/rubrics" className="btn btn-secondary">
                    Manage Rubrics
                </Link>
            </div>

            <div className="questions-section">
                <h2>Your Questions</h2>
                
                {questions.length === 0 ? (
                    <p className="empty-state">
                        No questions created yet. 
                        <Link to="/questions/create"> Create your first question</Link>
                    </p>
                ) : (
                    <div className="questions-grid">
                        {questions.map(question => {
                            const questionStats = stats[question._id];
                            return (
                                <div key={question._id} className="question-card teacher-card">
                                    <div className="card-header">
                                        <h3>{question.title}</h3>
                                        <span className={`status-badge ${question.isActive ? 'active' : 'inactive'}`}>
                                            {question.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    
                                    <div className="card-meta">
                                        {question.subject && <span>{question.subject}</span>}
                                        {question.difficulty && (
                                            <span className={`difficulty-${question.difficulty}`}>
                                                {question.difficulty}
                                            </span>
                                        )}
                                        <span>Max: {question.maxScore} pts</span>
                                    </div>

                                    {questionStats && (
                                        <div className="card-stats">
                                            <div className="stat">
                                                <span className="stat-value">{questionStats.totalSubmissions}</span>
                                                <span className="stat-label">Submissions</span>
                                            </div>
                                            {questionStats.averageScore != null && (
                                                <div className="stat">
                                                    <span className="stat-value">
                                                        {(questionStats.averageScore * 100).toFixed(0)}%
                                                    </span>
                                                    <span className="stat-label">Avg Score</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="card-actions">
                                        <Link 
                                            to={`/questions/${question._id}/submissions`}
                                            className="btn btn-sm btn-secondary"
                                        >
                                            View Submissions
                                        </Link>
                                        <button 
                                            onClick={() => handleDeleteQuestion(question._id)}
                                            className="btn btn-sm btn-danger"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TeacherDashboard;