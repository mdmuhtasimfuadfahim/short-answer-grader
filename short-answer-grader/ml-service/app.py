"""
FastAPI application for ASAG ML microservice.
Provides REST endpoints for embedding, grading, and training.
"""
import os
import logging
import time
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from config import SERVER_CONFIG, MODEL_CONFIGS, DEFAULT_MODEL
from inference import ASAGInferenceEngine, grade_answer, embed_text

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global engine instance
engine: Optional[ASAGInferenceEngine] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - initialize model on startup."""
    global engine
    logger.info("Initializing ASAG inference engine...")
    engine = ASAGInferenceEngine(model_name=DEFAULT_MODEL)
    logger.info(f"Engine ready with model: {engine.hf_model_name}")
    yield
    logger.info("Shutting down ASAG service")


# Initialize FastAPI app
app = FastAPI(
    title="ASAG ML Microservice",
    description="Automated Short Answer Grading with explainability",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========================
# Request/Response Models
# ========================

class EmbedRequest(BaseModel):
    """Request model for text embedding."""
    text: str = Field(..., description="Text to embed")
    model: Optional[str] = Field(None, description="Model to use (optional)")


class EmbedResponse(BaseModel):
    """Response model for text embedding."""
    embedding: List[float]
    dimension: int
    model: str


class RubricDimension(BaseModel):
    """Model for a single rubric dimension."""
    name: str = Field(..., description="Name of the rubric dimension")
    text: str = Field(..., description="Description/requirement for this dimension")
    weight: Optional[float] = Field(1.0, description="Weight for aggregation")


class GradeRequest(BaseModel):
    """Request model for grading."""
    question_id: Optional[str] = Field(None, description="Question identifier")
    student_id: Optional[str] = Field(None, description="Student identifier")
    answer_text: str = Field(..., description="Student's answer text")
    rubric_dims: Optional[List[RubricDimension]] = Field(
        None, 
        description="Rubric dimensions (optional if using stored rubrics)"
    )
    reference_answer: Optional[str] = Field(
        None,
        description="Reference answer for auto rubric generation"
    )
    compute_explanations: bool = Field(
        True,
        description="Whether to compute evidence spans"
    )


class HighlightSpan(BaseModel):
    """Model for an evidence highlight span."""
    text: str
    score: float
    char_start: Optional[int] = None
    char_end: Optional[int] = None


class DimensionResult(BaseModel):
    """Model for per-dimension grading result."""
    score: float
    confidence: float
    highlights: List[HighlightSpan] = []


class GradeResponse(BaseModel):
    """Response model for grading."""
    overall_score: float
    per_dimension: Dict[str, DimensionResult]
    feedback: List[str]
    metadata: Dict[str, Any]


class BatchGradeRequest(BaseModel):
    """Request model for batch grading."""
    answers: List[str] = Field(..., description="List of student answers")
    rubric_dims: List[RubricDimension] = Field(..., description="Rubric dimensions")


class BatchGradeResponse(BaseModel):
    """Response model for batch grading."""
    results: List[GradeResponse]
    total_time_ms: float


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str
    model: str
    device: str


class ModelInfo(BaseModel):
    """Model information."""
    name: str
    hf_name: str
    dimension: int
    description: str


class ModelsResponse(BaseModel):
    """Response model for available models."""
    models: List[ModelInfo]
    current_model: str


# ========================
# API Endpoints
# ========================

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Check service health and model status."""
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    return HealthResponse(
        status="healthy",
        model=engine.hf_model_name,
        device=engine.device
    )


@app.get("/models", response_model=ModelsResponse, tags=["System"])
async def list_models():
    """List available models."""
    models = [
        ModelInfo(
            name=key,
            hf_name=config["name"],
            dimension=config["dimension"],
            description=config["description"]
        )
        for key, config in MODEL_CONFIGS.items()
    ]
    
    return ModelsResponse(
        models=models,
        current_model=engine.model_name if engine else DEFAULT_MODEL
    )


@app.post("/embed", response_model=EmbedResponse, tags=["Inference"])
async def embed_endpoint(request: EmbedRequest):
    """
    Generate embedding for input text.
    
    Returns a dense vector representation of the input text.
    """
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    try:
        embedding = engine.encode_single(request.text)
        
        return EmbedResponse(
            embedding=embedding.tolist(),
            dimension=len(embedding),
            model=engine.hf_model_name
        )
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/grade", response_model=GradeResponse, tags=["Inference"])
async def grade_endpoint(request: GradeRequest):
    """
    Grade a student answer against rubric dimensions.
    
    Provides:
    - Overall score (0-1)
    - Per-dimension scores with confidence
    - Evidence span highlights
    - Textual feedback
    """
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    start_time = time.time()
    
    try:
        # Extract rubric dimensions
        if request.rubric_dims:
            rubric_texts = [dim.text for dim in request.rubric_dims]
            rubric_names = [dim.name for dim in request.rubric_dims]
            weights = [dim.weight for dim in request.rubric_dims]
        elif request.reference_answer:
            # Auto-generate rubrics from reference answer
            from utils.preprocessing import split_into_rubric_dims
            rubric_texts = split_into_rubric_dims(request.reference_answer)
            rubric_names = [f"Criterion {i+1}" for i in range(len(rubric_texts))]
            weights = None
        else:
            raise HTTPException(
                status_code=400,
                detail="Either rubric_dims or reference_answer must be provided"
            )
        
        # Perform grading
        result = engine.grade(
            student_answer=request.answer_text,
            rubric_dims=rubric_texts,
            rubric_names=rubric_names,
            weights=weights,
            compute_explanations=request.compute_explanations
        )
        
        # Add timing metadata
        elapsed_ms = (time.time() - start_time) * 1000
        result["metadata"]["time_ms"] = round(elapsed_ms, 2)
        result["metadata"]["question_id"] = request.question_id
        result["metadata"]["student_id"] = request.student_id
        
        # Convert to response model
        per_dimension = {
            name: DimensionResult(
                score=data["score"],
                confidence=data["confidence"],
                highlights=[
                    HighlightSpan(**h) for h in data["highlights"]
                ]
            )
            for name, data in result["per_dimension"].items()
        }
        
        return GradeResponse(
            overall_score=result["overall_score"],
            per_dimension=per_dimension,
            feedback=result["feedback"],
            metadata=result["metadata"]
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Grading error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/grade/batch", response_model=BatchGradeResponse, tags=["Inference"])
async def batch_grade_endpoint(request: BatchGradeRequest):
    """
    Grade multiple student answers efficiently.
    
    Optimized for batch processing with shared rubric encoding.
    """
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    start_time = time.time()
    
    try:
        rubric_texts = [dim.text for dim in request.rubric_dims]
        rubric_names = [dim.name for dim in request.rubric_dims]
        weights = [dim.weight for dim in request.rubric_dims]
        
        batch_results = engine.batch_grade(
            student_answers=request.answers,
            rubric_dims=rubric_texts,
            rubric_names=rubric_names,
            weights=weights
        )
        
        elapsed_ms = (time.time() - start_time) * 1000
        
        results = []
        for result in batch_results:
            per_dimension = {
                name: DimensionResult(
                    score=data["score"],
                    confidence=data["confidence"],
                    highlights=[]
                )
                for name, data in result["per_dimension"].items()
            }
            
            results.append(GradeResponse(
                overall_score=result["overall_score"],
                per_dimension=per_dimension,
                feedback=result["feedback"],
                metadata=result["metadata"]
            ))
        
        return BatchGradeResponse(
            results=results,
            total_time_ms=round(elapsed_ms, 2)
        )
    
    except Exception as e:
        logger.error(f"Batch grading error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/train", tags=["Training"])
async def train_endpoint(background_tasks: BackgroundTasks):
    """
    Trigger model training (admin only).
    
    This endpoint starts training in the background.
    """
    # TODO: Add authentication for admin-only access
    # TODO: Implement training trigger with data path
    
    return {
        "status": "Training endpoint placeholder",
        "message": "Use the train.py script for training"
    }


# ========================
# Main Entry Point
# ========================

if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host=SERVER_CONFIG["host"],
        port=SERVER_CONFIG["port"],
        workers=SERVER_CONFIG["workers"],
        reload=False
    )