# Short Answer Grader

Towards Explainable Automated Short Answer Grading using Language Models and Rubric-Aware Evaluation

## Author
**Md. Muhtasim Fuad Fahim**  
ID: 221043003  
Course: CSE 6231 - Deep Learning

## Project Structure

```
short-answer-grader/
├── backend/           # Node.js + Express API
├── frontend/          # React UI
├── ml-service/        # Python FastAPI ML service
├── data/              # Datasets
├── paper.tex          # Research paper (LaTeX)
└── implementation_guide.txt
```

## Technology Stack

### Backend
- Node.js v18+
- Express.js
- MongoDB
- JWT Authentication

### Frontend
- React 18
- React Router
- Axios

### ML Service
- Python 3.10+
- PyTorch
- Transformers (Hugging Face)
- Sentence-Transformers
- FastAPI

## Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- Python 3.10+
- MongoDB

### 1. Install Backend Dependencies
```bash
cd short-answer-grader/backend
npm install
```

### 2. Install Frontend Dependencies
```bash
cd short-answer-grader/frontend
npm install
```

### 3. Install ML Service Dependencies
```bash
cd short-answer-grader/ml-service
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create `.env` file in `backend/`:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/short-answer-grader
JWT_SECRET=your_secret_key_here
ML_SERVICE_URL=http://localhost:8001
NODE_ENV=development
```

### 5. Start MongoDB
```bash
mongod --dbpath /path/to/data/db
```

## Running the Application

### Start all services in separate terminals:

#### Terminal 1: ML Service
```bash
cd short-answer-grader/ml-service
uvicorn app:app --host 0.0.0.0 --port 8001 --reload
```

#### Terminal 2: Backend
```bash
cd short-answer-grader/backend
npm start
```

#### Terminal 3: Frontend
```bash
cd short-answer-grader/frontend
npm start
```

Access the application at: `http://localhost:3000`

## Testing the Application

### 1. Register Users
- Open `http://localhost:3000`
- Register as **Teacher** (role: teacher)
- Register as **Student** (role: student)

### 2. Teacher Workflow
- Login as teacher
- Navigate to "Create Question"
- Add a question with reference answer
- Navigate to "Manage Rubrics"
- Create rubric with dimensions and keywords
- Link rubric to question

### 3. Student Workflow
- Login as student
- Navigate to "Submit Answer"
- Select a question
- Submit your answer
- View grading results with:
  - Overall score
  - Per-dimension scores
  - Highlighted evidence
  - Confidence scores
  - Feedback text

### 4. View Results
- Teachers can view all submissions
- Students can view their own submissions

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/me` - Update profile
- `PUT /api/auth/password` - Change password

### Questions
- `GET /api/questions` - Get all questions
- `POST /api/questions` - Create question (teacher only)
- `GET /api/questions/:id` - Get question by ID
- `PUT /api/questions/:id` - Update question (teacher only)
- `DELETE /api/questions/:id` - Delete question (teacher only)

### Rubrics
- `GET /api/rubrics` - Get all rubrics
- `POST /api/rubrics` - Create rubric
- `GET /api/rubrics/:id` - Get rubric by ID
- `PUT /api/rubrics/:id` - Update rubric
- `DELETE /api/rubrics/:id` - Delete rubric

### Grading
- `POST /api/grading/submit` - Submit answer for grading
- `GET /api/grading/submissions` - Get user submissions
- `GET /api/grading/submissions/:id` - Get submission by ID

### ML Service
- `POST /grade` - Grade answer with explainability
- `GET /health` - Health check

## Features

### For Teachers
- Create and manage questions
- Create and manage rubrics with dimensions
- View all student submissions
- Configure grading criteria

### For Students
- Browse available questions
- Submit answers
- View detailed grading feedback
- See highlighted evidence spans
- Understand scoring rationale

### ML-Powered Grading
- Semantic similarity using Sentence-BERT/MiniLM/DeBERTa
- Rubric-aware scoring
- Per-dimension evaluation
- Confidence estimation
- Evidence highlighting
- Contrastive learning to prevent keyword stuffing

## License
GNU General Public License v3.0

## Citation
If you use this work, please cite:
```
Md. Muhtasim Fuad Fahim (2024). 
Towards Explainable Automated Short Answer Grading 
using Language Models and Rubric-Aware Evaluation.
```