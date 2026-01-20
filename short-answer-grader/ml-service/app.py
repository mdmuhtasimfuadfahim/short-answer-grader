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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global engine instance
engine = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager - initialize model on startup."""
    global engine
    logger.info("Initializing ASAG inference engine...")
    try:
        from inference import ASAGInferenceEngine
        engine = ASAGInferenceEngine(model_name=DEFAULT_MODEL)
        logger.info(f"Engine ready with model: {engine.hf_model_name}")
    except Exception as e:
        logger.error(f"Failed to initialize engine: {e}")
        logger.info("Service will start without model - some endpoints will be unavailable")
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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========================
# Request/Response Models
# ========================

class EmbedRequest(BaseModel):
    text: str = Field(..., description="Text to embed")
    model: Optional[str] = Field(None, description="Model to use (optional)")


class EmbedResponse(BaseModel):
    embedding: List[float]
    dimension: int
    model: str


class RubricDimension(BaseModel):
    name: str = Field(..., description="Name of the rubric dimension")
    text: str = Field(..., description="Description/requirement for this dimension")
    weight: Optional[float] = Field(1.0, description="Weight for aggregation")


class GradeRequest(BaseModel):
    question_id: Optional[str] = Field(None, description="Question identifier")
    student_id: Optional[str] = Field(None, description="Student identifier")
    answer_text: str = Field(..., description="Student's answer text")
    rubric_dims: Optional[List[RubricDimension]] = Field(
        None, 
        description="Rubric dimensions (optional if using reference_answer)"
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
    text: str
    score: float
    char_start: Optional[int] = None
    char_end: Optional[int] = None


class DimensionResult(BaseModel):
    score: float
    confidence: float
    highlights: List[HighlightSpan] = []


class GradeResponse(BaseModel):
    overall_score: float
    per_dimension: Dict[str, DimensionResult]
    feedback: List[str]
    metadata: Dict[str, Any]


class BatchGradeRequest(BaseModel):
    answers: List[str] = Field(..., description="List of student answers")
    rubric_dims: List[RubricDimension] = Field(..., description="Rubric dimensions")


class BatchGradeResponse(BaseModel):
    results: List[GradeResponse]
    total_time_ms: float


class HealthResponse(BaseModel):
    status: str
    model: str
    device: str


class ModelInfo(BaseModel):
    name: str
    hf_name: str
    dimension: int
    description: str


class ModelsResponse(BaseModel):
    models: List[ModelInfo]
    current_model: str


class SplitRubricRequest(BaseModel):
    text: str = Field(..., description="Reference answer text")
    num_dims: Optional[int] = Field(None, description="Number of dimensions to generate")


class SplitRubricResponse(BaseModel):
    dimensions: List[str]
    count: int


class ValidateAnswerRequest(BaseModel):
    text: str = Field(..., description="Student answer text")


class ValidateAnswerResponse(BaseModel):
    valid: bool
    word_count: int
    issues: List[str]


class SimilarityRequest(BaseModel):
    text1: str = Field(..., description="First text")
    text2: str = Field(..., description="Second text")


class SimilarityResponse(BaseModel):
    similarity: float
    confidence: float


# ========================
# API Endpoints
# ========================

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Check service health and model status."""
    if engine is None:
        return HealthResponse(
            status="degraded",
            model="none",
            device="none"
        )
    
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
    """Generate embedding for input text."""
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
    """Grade a student answer against rubric dimensions."""
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    start_time = time.time()
    
    try:
        # Extract rubric dimensions
        if request.rubric_dims and len(request.rubric_dims) > 0:
            rubric_texts = [dim.text for dim in request.rubric_dims]
            rubric_names = [dim.name for dim in request.rubric_dims]
            weights = [dim.weight or 1.0 for dim in request.rubric_dims]
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
        
        logger.info(f"Grading with {len(rubric_texts)} rubric dimensions")
        
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
        per_dimension = {}
        for name, data in result["per_dimension"].items():
            highlights = []
            for h in data.get("highlights", []):
                highlights.append(HighlightSpan(
                    text=h.get("text", ""),
                    score=h.get("score", 0.0),
                    char_start=h.get("char_start"),
                    char_end=h.get("char_end")
                ))
            per_dimension[name] = DimensionResult(
                score=data["score"],
                confidence=data["confidence"],
                highlights=highlights
            )
        
        return GradeResponse(
            overall_score=result["overall_score"],
            per_dimension=per_dimension,
            feedback=result.get("feedback", []),
            metadata=result.get("metadata", {})
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Grading error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/grade/batch", response_model=BatchGradeResponse, tags=["Inference"])
async def batch_grade_endpoint(request: BatchGradeRequest):
    """Grade multiple student answers efficiently."""
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    start_time = time.time()
    
    try:
        rubric_texts = [dim.text for dim in request.rubric_dims]
        rubric_names = [dim.name for dim in request.rubric_dims]
        weights = [dim.weight or 1.0 for dim in request.rubric_dims]
        
        batch_results = engine.batch_grade(
            student_answers=request.answers,
            rubric_dims=rubric_texts,
            rubric_names=rubric_names,
            weights=weights
        )
        
        elapsed_ms = (time.time() - start_time) * 1000
        
        results = []
        for result in batch_results:
            per_dimension = {}
            for name, data in result["per_dimension"].items():
                per_dimension[name] = DimensionResult(
                    score=data["score"],
                    confidence=data["confidence"],
                    highlights=[]
                )
            
            results.append(GradeResponse(
                overall_score=result["overall_score"],
                per_dimension=per_dimension,
                feedback=result.get("feedback", []),
                metadata=result.get("metadata", {})
            ))
        
        return BatchGradeResponse(
            results=results,
            total_time_ms=round(elapsed_ms, 2)
        )
    
    except Exception as e:
        logger.error(f"Batch grading error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rubric/split", response_model=SplitRubricResponse, tags=["Rubric"])
async def split_rubric_endpoint(request: SplitRubricRequest):
    """Split reference answer into rubric dimensions."""
    try:
        from utils.preprocessing import split_into_rubric_dims
        
        dimensions = split_into_rubric_dims(
            request.text,
            num_dims=request.num_dims
        )
        
        logger.info(f"Split reference into {len(dimensions)} dimensions")
        
        return SplitRubricResponse(
            dimensions=dimensions,
            count=len(dimensions)
        )
    except Exception as e:
        logger.error(f"Rubric splitting error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/validate", response_model=ValidateAnswerResponse, tags=["Validation"])
async def validate_answer_endpoint(request: ValidateAnswerRequest):
    """Validate student answer quality."""
    try:
        text = request.text.strip() if request.text else ""
        issues = []
        
        # Word count check
        words = text.split() if text else []
        word_count = len(words)
        
        if word_count < 3:
            issues.append("Answer is too short (minimum 3 words)")
        
        # Check for excessive repetition
        if word_count > 10:
            unique_words = len(set(word.lower() for word in words))
            if unique_words / word_count < 0.3:
                issues.append("Answer contains excessive repetition")
        
        # Check for placeholder text
        placeholders = ["lorem ipsum", "test", "asdf", "xxxx", "todo", "placeholder"]
        text_lower = text.lower()
        if any(ph in text_lower for ph in placeholders):
            issues.append("Answer contains placeholder text")
        
        valid = len(issues) == 0
        
        return ValidateAnswerResponse(
            valid=valid,
            word_count=word_count,
            issues=issues
        )
    except Exception as e:
        logger.error(f"Validation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/similarity", response_model=SimilarityResponse, tags=["Inference"])
async def similarity_endpoint(request: SimilarityRequest):
    """Compute semantic similarity between two texts."""
    if engine is None:
        raise HTTPException(status_code=503, detail="Model not initialized")
    
    try:
        from utils.scorer import compute_cosine_similarity, compute_confidence
        
        # Encode both texts
        emb1 = engine.encode_single(request.text1)
        emb2 = engine.encode_single(request.text2)
        
        # Compute similarity
        similarity = compute_cosine_similarity(emb1, emb2)
        confidence = compute_confidence(similarity)
        
        return SimilarityResponse(
            similarity=float(similarity),
            confidence=float(confidence)
        )
    except Exception as e:
        logger.error(f"Similarity computation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/train", tags=["Training"])
async def train_endpoint(background_tasks: BackgroundTasks):
    """Trigger model training (admin only)."""
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