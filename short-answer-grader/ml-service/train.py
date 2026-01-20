"""
Training pipeline for fine-tuning sentence encoders with contrastive learning.
"""
import os
import json
import argparse
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from datetime import datetime

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torch.optim import AdamW
from torch.optim.lr_scheduler import LinearLR
from sentence_transformers import SentenceTransformer
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
import numpy as np
from tqdm import tqdm

from config import TRAINING_CONFIG, MODELS_DIR, MODEL_CONFIGS
from utils.preprocessing import preprocess_text, split_into_rubric_dims
from utils.scorer import compute_cosine_similarity, scale_similarity, aggregate_scores
from utils.contrastive import CombinedLoss, create_negative_samples

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ASAGDataset(Dataset):
    """
    Dataset for ASAG training with contrastive samples.
    """
    
    def __init__(
        self,
        records: List[Dict],
        all_answers: List[str],
        all_rubrics: List[str],
        num_negatives: int = 5
    ):
        """
        Initialize dataset.
        
        Args:
            records: List of training records with rubric_dims, student_answer, true_score
            all_answers: Pool of all student answers for negative sampling
            all_rubrics: Pool of all rubric dimensions for negative sampling
            num_negatives: Number of negative samples per example
        """
        self.records = records
        self.all_answers = all_answers
        self.all_rubrics = all_rubrics
        self.num_negatives = num_negatives
    
    def __len__(self) -> int:
        return len(self.records)
    
    def __getitem__(self, idx: int) -> Dict:
        record = self.records[idx]
        
        student_answer = record["student_answer"]
        rubric_dims = record["rubric_dims"]
        true_score = record["true_score"]
        
        # Select a random rubric dimension as positive
        positive_rubric = np.random.choice(rubric_dims)
        
        # Create negative samples
        other_answers = [a for a in self.all_answers if a != student_answer]
        other_rubrics = [r for r in self.all_rubrics if r not in rubric_dims]
        
        negatives = create_negative_samples(
            student_answer,
            positive_rubric,
            other_answers,
            other_rubrics,
            num_negatives=self.num_negatives
        )
        
        return {
            "student_answer": student_answer,
            "positive_rubric": positive_rubric,
            "negatives": negatives,
            "all_rubrics": rubric_dims,
            "true_score": true_score
        }


def collate_fn(batch: List[Dict]) -> Dict:
    """Collate function for DataLoader."""
    return {
        "student_answers": [b["student_answer"] for b in batch],
        "positive_rubrics": [b["positive_rubric"] for b in batch],
        "negatives_list": [b["negatives"] for b in batch],
        "all_rubrics_list": [b["all_rubrics"] for b in batch],
        "true_scores": torch.tensor([b["true_score"] for b in batch], dtype=torch.float32)
    }


class ASAGTrainer:
    """
    Trainer for fine-tuning sentence encoders with contrastive + regression objectives.
    """
    
    def __init__(
        self,
        model_name: str = "minilm",
        device: Optional[str] = None,
        config: Optional[Dict] = None
    ):
        """
        Initialize trainer.
        
        Args:
            model_name: Model key from MODEL_CONFIGS
            device: Device to use
            config: Training configuration overrides
        """
        self.model_name = model_name
        self.config = {**TRAINING_CONFIG, **(config or {})}
        
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
        
        # Get HuggingFace model name
        if model_name in MODEL_CONFIGS:
            self.hf_model_name = MODEL_CONFIGS[model_name]["name"]
        else:
            self.hf_model_name = model_name
        
        # Load model
        self.model = SentenceTransformer(self.hf_model_name, device=self.device)
        
        # Initialize loss function
        self.criterion = CombinedLoss(
            temperature=self.config["temperature"],
            alpha=self.config["alpha"],
            beta=self.config["beta"]
        )
        
        logger.info(f"Initialized trainer with {self.hf_model_name} on {self.device}")
    
    def _compute_predicted_scores(
        self,
        student_embeddings: torch.Tensor,
        rubric_lists: List[List[str]]
    ) -> torch.Tensor:
        """
        Compute predicted scores from embeddings.
        
        Args:
            student_embeddings: Student answer embeddings
            rubric_lists: List of rubric dimension lists for each student
            
        Returns:
            Predicted scores tensor
        """
        predicted_scores = []
        
        for i, rubrics in enumerate(rubric_lists):
            student_emb = student_embeddings[i].cpu().numpy()
            
            # Encode rubrics
            rubric_embs = self.model.encode(rubrics, convert_to_numpy=True)
            
            # Compute scores for each dimension
            dim_scores = []
            for rubric_emb in rubric_embs:
                sim = compute_cosine_similarity(student_emb, rubric_emb)
                dim_scores.append(scale_similarity(sim))
            
            # Aggregate
            overall = aggregate_scores(dim_scores)
            predicted_scores.append(overall)
        
        return torch.tensor(predicted_scores, dtype=torch.float32, device=self.device)
    
    def train(
        self,
        train_records: List[Dict],
        val_records: Optional[List[Dict]] = None,
        output_dir: Optional[str] = None
    ) -> Dict:
        """
        Train the model.
        
        Args:
            train_records: Training data records
            val_records: Validation data records
            output_dir: Directory to save model checkpoints
            
        Returns:
            Training history dictionary
        """
        # Prepare output directory
        if output_dir is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_dir = MODELS_DIR / f"{self.model_name}_{timestamp}"
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Collect all answers and rubrics for negative sampling
        all_answers = list(set(r["student_answer"] for r in train_records))
        all_rubrics = list(set(
            rubric for r in train_records for rubric in r["rubric_dims"]
        ))
        
        # Create dataset and dataloader
        train_dataset = ASAGDataset(
            train_records, all_answers, all_rubrics,
            num_negatives=5
        )
        train_loader = DataLoader(
            train_dataset,
            batch_size=self.config["batch_size"],
            shuffle=True,
            collate_fn=collate_fn
        )
        
        # Optimizer
        optimizer = AdamW(
            self.model.parameters(),
            lr=self.config["learning_rate"]
        )
        
        # Learning rate scheduler
        total_steps = len(train_loader) * self.config["epochs"]
        warmup_steps = int(total_steps * self.config["warmup_ratio"])
        scheduler = LinearLR(
            optimizer,
            start_factor=0.1,
            end_factor=1.0,
            total_iters=warmup_steps
        )
        
        # Training history
        history = {
            "train_loss": [],
            "val_mae": [],
            "best_val_mae": float("inf"),
            "config": self.config
        }
        
        # Training loop
        logger.info(f"Starting training for {self.config['epochs']} epochs")
        
        for epoch in range(self.config["epochs"]):
            self.model.train()
            epoch_losses = {"contrastive": [], "regression": [], "total": []}
            
            progress = tqdm(train_loader, desc=f"Epoch {epoch + 1}")
            
            for batch in progress:
                optimizer.zero_grad()
                
                # Encode student answers
                student_embs = self.model.encode(
                    batch["student_answers"],
                    convert_to_tensor=True,
                    device=self.device
                )
                
                # Encode positive rubrics
                positive_embs = self.model.encode(
                    batch["positive_rubrics"],
                    convert_to_tensor=True,
                    device=self.device
                )
                
                # Encode negatives
                batch_negatives = []
                for negs in batch["negatives_list"]:
                    neg_embs = self.model.encode(
                        negs,
                        convert_to_tensor=True,
                        device=self.device
                    )
                    batch_negatives.append(neg_embs)
                
                # Stack negatives: (batch_size, num_negatives, embedding_dim)
                negatives_tensor = torch.stack(batch_negatives)
                
                # Compute predicted scores
                predicted_scores = self._compute_predicted_scores(
                    student_embs,
                    batch["all_rubrics_list"]
                )
                
                true_scores = batch["true_scores"].to(self.device)
                
                # Compute loss
                loss, loss_components = self.criterion(
                    student_embs,
                    positive_embs,
                    negatives_tensor,
                    predicted_scores,
                    true_scores
                )
                
                # Backward pass
                loss.backward()
                optimizer.step()
                scheduler.step()
                
                # Record losses
                epoch_losses["contrastive"].append(loss_components["contrastive_loss"])
                epoch_losses["regression"].append(loss_components["regression_loss"])
                epoch_losses["total"].append(loss_components["total_loss"])
                
                progress.set_postfix({
                    "loss": f"{loss_components['total_loss']:.4f}",
                    "con": f"{loss_components['contrastive_loss']:.4f}",
                    "reg": f"{loss_components['regression_loss']:.4f}"
                })
            
            # Epoch summary
            avg_loss = np.mean(epoch_losses["total"])
            history["train_loss"].append(avg_loss)
            
            logger.info(
                f"Epoch {epoch + 1}: "
                f"Total Loss = {avg_loss:.4f}, "
                f"Contrastive = {np.mean(epoch_losses['contrastive']):.4f}, "
                f"Regression = {np.mean(epoch_losses['regression']):.4f}"
            )
            
            # Validation
            if val_records:
                val_mae = self.evaluate(val_records)
                history["val_mae"].append(val_mae)
                logger.info(f"Validation MAE: {val_mae:.4f}")
                
                # Save best model
                if val_mae < history["best_val_mae"]:
                    history["best_val_mae"] = val_mae
                    self.save_model(output_dir / "best_model")
                    logger.info(f"New best model saved (MAE: {val_mae:.4f})")
        
        # Save final model
        self.save_model(output_dir / "final_model")
        
        # Save training history
        with open(output_dir / "training_history.json", "w") as f:
            json.dump(history, f, indent=2)
        
        logger.info(f"Training complete. Models saved to {output_dir}")
        
        return history
    
    def evaluate(self, records: List[Dict]) -> float:
        """
        Evaluate model on a set of records.
        
        Args:
            records: Evaluation records
            
        Returns:
            Mean Absolute Error
        """
        self.model.eval()
        
        true_scores = []
        pred_scores = []
        
        with torch.no_grad():
            for record in records:
                student_emb = self.model.encode(
                    record["student_answer"],
                    convert_to_numpy=True
                )
                
                rubric_embs = self.model.encode(
                    record["rubric_dims"],
                    convert_to_numpy=True
                )
                
                dim_scores = []
                for rubric_emb in rubric_embs:
                    sim = compute_cosine_similarity(student_emb, rubric_emb)
                    dim_scores.append(scale_similarity(sim))
                
                pred_score = aggregate_scores(dim_scores)
                
                true_scores.append(record["true_score"])
                pred_scores.append(pred_score)
        
        return mean_absolute_error(true_scores, pred_scores)
    
    def save_model(self, path: str):
        """Save the model to disk."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        self.model.save(str(path))
        logger.info(f"Model saved to {path}")
    
    def load_model(self, path: str):
        """Load model from disk."""
        self.model = SentenceTransformer(path, device=self.device)
        logger.info(f"Model loaded from {path}")


def load_dataset(path: str) -> List[Dict]:
    """
    Load dataset from JSON file.
    
    Expected format:
    [
        {
            "question_id": "q1",
            "reference_answer": "...",
            "rubric_dims": ["dim1", "dim2"],  # optional
            "student_answer": "...",
            "true_score": 0.75
        },
        ...
    ]
    """
    with open(path, "r") as f:
        data = json.load(f)
    
    records = []
    for item in data:
        # Auto-generate rubric dims if not provided
        if "rubric_dims" not in item or not item["rubric_dims"]:
            item["rubric_dims"] = split_into_rubric_dims(
                item.get("reference_answer", "")
            )
        
        records.append({
            "question_id": item.get("question_id", ""),
            "rubric_dims": [preprocess_text(d) for d in item["rubric_dims"]],
            "student_answer": preprocess_text(item["student_answer"]),
            "true_score": float(item["true_score"])
        })
    
    return records


def main():
    parser = argparse.ArgumentParser(description="Train ASAG model")
    parser.add_argument(
        "--model", type=str, default="minilm",
        choices=list(MODEL_CONFIGS.keys()),
        help="Model to train"
    )
    parser.add_argument(
        "--data", type=str, required=True,
        help="Path to training data JSON"
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output directory for model"
    )
    parser.add_argument(
        "--epochs", type=int, default=TRAINING_CONFIG["epochs"],
        help="Number of training epochs"
    )
    parser.add_argument(
        "--batch-size", type=int, default=TRAINING_CONFIG["batch_size"],
        help="Batch size"
    )
    parser.add_argument(
        "--lr", type=float, default=TRAINING_CONFIG["learning_rate"],
        help="Learning rate"
    )
    parser.add_argument(
        "--val-split", type=float, default=0.1,
        help="Validation split ratio"
    )
    
    args = parser.parse_args()
    
    # Load data
    logger.info(f"Loading data from {args.data}")
    records = load_dataset(args.data)
    logger.info(f"Loaded {len(records)} records")
    
    # Split data
    train_records, val_records = train_test_split(
        records,
        test_size=args.val_split,
        random_state=42
    )
    logger.info(f"Train: {len(train_records)}, Val: {len(val_records)}")
    
    # Initialize trainer
    config = {
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.lr
    }
    trainer = ASAGTrainer(model_name=args.model, config=config)
    
    # Train
    history = trainer.train(
        train_records,
        val_records,
        output_dir=args.output
    )
    
    print(f"\nTraining complete!")
    print(f"Best validation MAE: {history['best_val_mae']:.4f}")


if __name__ == "__main__":
    main()