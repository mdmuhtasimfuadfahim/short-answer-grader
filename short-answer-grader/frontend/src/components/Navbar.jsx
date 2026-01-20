import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
    const { user, logout, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <nav className="navbar">
            <div className="navbar-brand">
                <Link to="/">Short Answer Grader</Link>
            </div>

            <div className="navbar-links">
                {isAuthenticated ? (
                    <>
                        {user?.role === 'teacher' && (
                            <>
                                <Link to="/teacher" className="nav-link">Dashboard</Link>
                                <Link to="/questions/create" className="nav-link">Create Question</Link>
                                <Link to="/rubrics" className="nav-link">Rubrics</Link>
                            </>
                        )}
                        {user?.role === 'student' && (
                            <Link to="/student" className="nav-link">Dashboard</Link>
                        )}
                        <div className="user-menu">
                            <span className="user-name">{user?.name}</span>
                            <span className="user-role">({user?.role})</span>
                            <button onClick={handleLogout} className="btn btn-sm btn-logout">
                                Logout
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <Link to="/login" className="nav-link">Login</Link>
                        <Link to="/register" className="nav-link">Register</Link>
                    </>
                )}
            </div>
        </nav>
    );
};

export default Navbar;