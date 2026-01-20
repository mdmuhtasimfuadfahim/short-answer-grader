import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import StudentDashboard from './pages/StudentDashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import CreateQuestion from './pages/CreateQuestion';
import ManageRubrics from './pages/ManageRubrics';
import SubmitAnswer from './pages/SubmitAnswer';
import ViewResults from './pages/ViewResults';

// Styles
import './styles/App.css';

function App() {
    return (
        <AuthProvider>
            <Router>
                <div className="app">
                    <Navbar />
                    <main className="main-content">
                        <Routes>
                            {/* Public Routes */}
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/register" element={<RegisterPage />} />

                            {/* Student Routes */}
                            <Route
                                path="/student"
                                element={
                                    <ProtectedRoute allowedRoles={['student']}>
                                        <StudentDashboard />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/submit/:questionId"
                                element={
                                    <ProtectedRoute allowedRoles={['student']}>
                                        <SubmitAnswer />
                                    </ProtectedRoute>
                                }
                            />

                            {/* Teacher Routes */}
                            <Route
                                path="/teacher"
                                element={
                                    <ProtectedRoute allowedRoles={['teacher']}>
                                        <TeacherDashboard />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/questions/create"
                                element={
                                    <ProtectedRoute allowedRoles={['teacher']}>
                                        <CreateQuestion />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/questions/edit/:id"
                                element={
                                    <ProtectedRoute allowedRoles={['teacher']}>
                                        <CreateQuestion />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/rubrics"
                                element={
                                    <ProtectedRoute allowedRoles={['teacher']}>
                                        <ManageRubrics />
                                    </ProtectedRoute>
                                }
                            />

                            {/* Shared Routes */}
                            <Route
                                path="/results/:submissionId"
                                element={
                                    <ProtectedRoute allowedRoles={['student', 'teacher']}>
                                        <ViewResults />
                                    </ProtectedRoute>
                                }
                            />

                            {/* Default Redirect */}
                            <Route path="/" element={<Navigate to="/login" replace />} />
                            <Route path="*" element={<Navigate to="/login" replace />} />
                        </Routes>
                    </main>
                </div>
            </Router>
        </AuthProvider>
    );
}

export default App;