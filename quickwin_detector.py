#!/usr/bin/env python3
"""
QuickWin Detector — 6-Factor Scoring for Task Prioritization

Factors:
1. Effort (hours) — Lower is better
2. Impact (user value) — Higher is better
3. Momentum (unblocks other tasks) — Higher is better
4. Energy (team morale boost) — Higher is better
5. Recency (how recently added) — Newer is better
6. Staleness (how long pending) — Older is better

Score = (impact * momentum * energy) / (effort * recency_penalty * staleness_bonus)
"""

import json
from datetime import datetime
from typing import Dict, List, Any
from dataclasses import dataclass


@dataclass
class QuickWinScore:
    """Scoring breakdown for a task"""
    task_id: str
    total_score: float
    effort: float
    impact: float
    momentum: float
    energy: float
    recency: float
    staleness: float
    reason: str
    estimated_hours: float


class QuickWinDetector:
    """Detects high-value, low-effort tasks using 6-factor scoring"""
    
    # Scoring weights (tunable)
    WEIGHTS = {
        "effort": 1.0,
        "impact": 2.0,
        "momentum": 1.5,
        "energy": 1.2,
        "recency": 0.8,
        "staleness": 1.0
    }
    
    # Thresholds
    QUICKWIN_THRESHOLD = 5.0  # Minimum score to be considered quickwin
    MAX_EFFORT_HOURS = 4.0    # Max hours for quickwin
    
    def __init__(self, memory_manager):
        self.memory = memory_manager
        self.history = []
    
    def detect_quickwins(self, tasks_data: Dict) -> List[Dict]:
        """Detect quickwin tasks from task database"""
        quickwins = []
        
        # Extract tasks (handle different formats)
        tasks = self._extract_tasks(tasks_data)
        
        for task in tasks:
            score = self._score_task(task)
            
            if score.total_score >= self.QUICKWIN_THRESHOLD and score.effort <= self.MAX_EFFORT_HOURS:
                quickwins.append({
                    "task_id": score.task_id,
                    "score": score.total_score,
                    "estimated_hours": score.estimated_hours,
                    "reason": score.reason,
                    "breakdown": {
                        "effort": score.effort,
                        "impact": score.impact,
                        "momentum": score.momentum,
                        "energy": score.energy,
                        "recency": score.recency,
                        "staleness": score.staleness
                    }
                })
        
        # Sort by score descending
        quickwins.sort(key=lambda x: x["score"], reverse=True)
        
        return quickwins
    
    def _extract_tasks(self, tasks_data: Dict) -> List[Dict]:
        """Extract task list from various formats"""
        tasks = []
        
        # Handle unified_tasks.json format
        if "metadata" in tasks_data:
            # Tasks might be in separate files, load them
            # For now, return empty list (will be populated by actual task loading)
            pass
        
        # For demo, create sample tasks
        # In real implementation, this would load from track_a/track_b task files
        return []
    
    def _score_task(self, task: Dict) -> QuickWinScore:
        """Calculate 6-factor score for a task"""
        task_id = task.get("id", "unknown")
        
        # Factor 1: Effort (inverse — lower is better)
        effort_hours = task.get("estimated_hours", 8.0)
        effort_score = 1.0 / max(effort_hours, 0.5)  # Avoid division by zero
        
        # Factor 2: Impact (user value)
        impact_score = self._calculate_impact(task)
        
        # Factor 3: Momentum (unblocks other tasks)
        momentum_score = self._calculate_momentum(task)
        
        # Factor 4: Energy (team morale)
        energy_score = self._calculate_energy(task)
        
        # Factor 5: Recency (how recently added)
        recency_score = self._calculate_recency(task)
        
        # Factor 6: Staleness (how long pending)
        staleness_score = self._calculate_staleness(task)
        
        # Calculate weighted total
        total_score = (
            (impact_score * self.WEIGHTS["impact"]) *
            (momentum_score * self.WEIGHTS["momentum"]) *
            (energy_score * self.WEIGHTS["energy"])
        ) / (
            (effort_score * self.WEIGHTS["effort"]) *
            max(recency_score * self.WEIGHTS["recency"], 0.1) *
            max(staleness_score * self.WEIGHTS["staleness"], 0.1)
        )
        
        # Generate reason
        reason = self._generate_reason(task, impact_score, momentum_score, energy_score, effort_hours)
        
        return QuickWinScore(
            task_id=task_id,
            total_score=total_score,
            effort=effort_score,
            impact=impact_score,
            momentum=momentum_score,
            energy=energy_score,
            recency=recency_score,
            staleness=staleness_score,
            reason=reason,
            estimated_hours=effort_hours
        )
    
    def _calculate_impact(self, task: Dict) -> float:
        """Calculate user/business impact score (0-10)"""
        priority = task.get("priority", "MEDIUM")
        tags = task.get("tags", [])
        
        score = 5.0  # Base score
        
        # Priority boost
        if priority == "CRITICAL":
            score += 3.0
        elif priority == "HIGH":
            score += 2.0
        elif priority == "LOW":
            score -= 1.0
        
        # Tag-based impact
        if "user-facing" in tags:
            score += 2.0
        if "blocker" in tags:
            score += 2.0
        if "core" in tags:
            score += 1.5
        if "cleanup" in tags:
            score -= 0.5
        
        return min(max(score, 0), 10)
    
    def _calculate_momentum(self, task: Dict) -> float:
        """Calculate how many tasks this unblocks (0-10)"""
        dependencies = task.get("unblocks", [])
        
        if not dependencies:
            return 1.0
        
        # More unblocked tasks = higher momentum
        score = min(len(dependencies) * 2.0, 10.0)
        return score
    
    def _calculate_energy(self, task: Dict) -> float:
        """Calculate team morale/energy boost (0-10)"""
        tags = task.get("tags", [])
        description = task.get("description", "").lower()
        
        score = 5.0  # Base score
        
        # Positive energy tasks
        if "quick-win" in tags or "polish" in tags:
            score += 2.0
        if "user-facing" in tags:
            score += 1.5
        if "cleanup" in tags or "refactor" in tags:
            score += 1.0
        
        # Negative energy tasks
        if "tedious" in description or "boring" in description:
            score -= 2.0
        if "complex" in description:
            score -= 1.0
        
        return min(max(score, 0), 10)
    
    def _calculate_recency(self, task: Dict) -> float:
        """Calculate recency penalty (newer tasks = lower penalty)"""
        created_at = task.get("created_at")
        
        if not created_at:
            return 1.0  # Neutral if unknown
        
        # Parse date
        try:
            created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            now = datetime.now(created.tzinfo)
            days_old = (now - created).days
            
            # Newer tasks get lower penalty (0.5-1.5)
            if days_old < 7:
                return 0.5  # Very recent
            elif days_old < 30:
                return 0.8
            else:
                return 1.2  # Older tasks
        except:
            return 1.0
    
    def _calculate_staleness(self, task: Dict) -> float:
        """Calculate staleness bonus (older pending tasks = higher bonus)"""
        status = task.get("status", "not_started")
        created_at = task.get("created_at")
        
        if status != "not_started":
            return 1.0  # Only applies to pending tasks
        
        if not created_at:
            return 1.0
        
        try:
            created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            now = datetime.now(created.tzinfo)
            days_pending = (now - created).days
            
            # Older pending tasks get bonus (1.0-2.0)
            if days_pending > 90:
                return 2.0  # Very stale
            elif days_pending > 30:
                return 1.5
            elif days_pending > 7:
                return 1.2
            else:
                return 1.0
        except:
            return 1.0
    
    def _generate_reason(self, task: Dict, impact: float, momentum: float, energy: float, effort: float) -> str:
        """Generate human-readable reason for quickwin"""
        reasons = []
        
        if effort <= 2.0:
            reasons.append("very low effort")
        elif effort <= 4.0:
            reasons.append("low effort")
        
        if impact >= 8.0:
            reasons.append("high impact")
        elif impact >= 6.0:
            reasons.append("good impact")
        
        if momentum >= 5.0:
            reasons.append(f"unblocks {len(task.get('unblocks', []))} tasks")
        
        if energy >= 7.0:
            reasons.append("morale boost")
        
        if not reasons:
            reasons.append("balanced score")
        
        return ", ".join(reasons)
    
    def update_history(self, evaluation: Dict):
        """Update quickwin history with execution results"""
        self.history.append({
            "timestamp": datetime.utcnow().isoformat(),
            "evaluation": evaluation
        })
        
        # Save to memory
        history_file = self.memory.memory_dir / "quickwin_history.json"
        with open(history_file, "w") as f:
            json.dump(self.history, f, indent=2)
    
    def get_statistics(self) -> Dict:
        """Get quickwin detection statistics"""
        return {
            "total_detected": len(self.history),
            "average_score": sum(h.get("score", 0) for h in self.history) / len(self.history) if self.history else 0,
            "success_rate": sum(1 for h in self.history if h.get("evaluation", {}).get("successful", 0) > 0) / len(self.history) if self.history else 0
        }
