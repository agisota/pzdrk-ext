#!/usr/bin/env python3
"""
Memory Manager — Persistent Cross-Session Learning

Memory Store:
- session_log.jsonl (append-only)
- lessons_learned.json (categorized insights)
- agent_performance.json (metrics tracking)
- rules.json (learned rules)
- context_snapshots/ (iteration states)
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
from collections import defaultdict


class MemoryManager:
    """Manages persistent memory across sessions"""
    
    def __init__(self, memory_dir: Path):
        self.memory_dir = memory_dir
        self.session_log_file = memory_dir / "session_log.jsonl"
        self.lessons_file = memory_dir / "lessons_learned.json"
        self.performance_file = memory_dir / "agent_performance.json"
        self.rules_file = memory_dir / "rules.json"
        
        # In-memory caches
        self.lessons: Dict[str, List[Dict]] = defaultdict(list)
        self.rules: List[Dict] = []
        self.current_session_id: str = ""
    
    def initialize(self):
        """Initialize memory system"""
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        
        # Create new session
        self.current_session_id = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        
        # Load existing memory
        self._load_lessons()
        self._load_rules()
        
        # Log session start
        self._append_session_log({
            "event": "session_start",
            "session_id": self.current_session_id,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        print(f"📚 Memory initialized (session: {self.current_session_id})")
    
    def _load_lessons(self):
        """Load lessons from disk"""
        if self.lessons_file.exists():
            with open(self.lessons_file) as f:
                data = json.load(f)
                self.lessons = defaultdict(list, data)
    
    def _load_rules(self):
        """Load rules from disk"""
        if self.rules_file.exists():
            with open(self.rules_file) as f:
                self.rules = json.load(f)
    
    def _append_session_log(self, entry: Dict):
        """Append entry to session log (append-only)"""
        entry["session_id"] = self.current_session_id
        entry["timestamp"] = entry.get("timestamp", datetime.utcnow().isoformat())
        
        with open(self.session_log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
    
    def log_iteration(self, iteration_data: Dict):
        """Log a complete iteration"""
        self._append_session_log({
            "event": "iteration",
            "data": iteration_data
        })
    
    def add_lesson(self, category: str, lesson: str, context: Optional[Dict] = None):
        """Add a learned lesson"""
        lesson_entry = {
            "lesson": lesson,
            "learned_at": datetime.utcnow().isoformat(),
            "session_id": self.current_session_id,
            "context": context or {}
        }
        
        self.lessons[category].append(lesson_entry)
        
        # Save to disk
        with open(self.lessons_file, "w") as f:
            json.dump(dict(self.lessons), f, indent=2)
        
        # Log to session
        self._append_session_log({
            "event": "lesson_learned",
            "category": category,
            "lesson": lesson
        })
    
    def get_lessons(self, category: Optional[str] = None) -> List[Dict]:
        """Get lessons, optionally filtered by category"""
        if category:
            return self.lessons.get(category, [])
        else:
            # Return all lessons
            all_lessons = []
            for cat, lessons in self.lessons.items():
                for lesson in lessons:
                    lesson["category"] = cat
                    all_lessons.append(lesson)
            return all_lessons
    
    def get_recent_insights(self, limit: int = 5) -> List[str]:
        """Get most recent insights across all categories"""
        all_lessons = self.get_lessons()
        
        # Sort by timestamp descending
        all_lessons.sort(key=lambda x: x["learned_at"], reverse=True)
        
        # Return just the lesson text
        return [lesson["lesson"] for lesson in all_lessons[:limit]]
    
    def add_rule(self, rule: str, condition: str, action: str, confidence: float = 1.0):
        """Add a learned rule"""
        rule_entry = {
            "id": f"RULE-{len(self.rules) + 1:03d}",
            "rule": rule,
            "condition": condition,
            "action": action,
            "confidence": confidence,
            "created_at": datetime.utcnow().isoformat(),
            "session_id": self.current_session_id,
            "applied_count": 0,
            "success_count": 0
        }
        
        self.rules.append(rule_entry)
        
        # Save to disk
        with open(self.rules_file, "w") as f:
            json.dump(self.rules, f, indent=2)
        
        # Log to session
        self._append_session_log({
            "event": "rule_created",
            "rule": rule_entry
        })
    
    def get_applicable_rules(self, context: Dict) -> List[Dict]:
        """Get rules applicable to current context"""
        applicable = []
        
        for rule in self.rules:
            # Simple condition matching (can be enhanced with eval or pattern matching)
            if self._evaluate_condition(rule["condition"], context):
                applicable.append(rule)
        
        # Sort by confidence descending
        applicable.sort(key=lambda x: x["confidence"], reverse=True)
        
        return applicable
    
    def _evaluate_condition(self, condition: str, context: Dict) -> bool:
        """Evaluate if a rule condition matches context"""
        # Simple keyword matching for now
        # In production, use proper expression evaluation
        
        condition_lower = condition.lower()
        
        # Check for keywords in context
        for key, value in context.items():
            if key.lower() in condition_lower:
                return True
            if str(value).lower() in condition_lower:
                return True
        
        return False
    
    def update_rule_stats(self, rule_id: str, success: bool):
        """Update rule application statistics"""
        for rule in self.rules:
            if rule["id"] == rule_id:
                rule["applied_count"] += 1
                if success:
                    rule["success_count"] += 1
                
                # Update confidence based on success rate
                if rule["applied_count"] > 0:
                    rule["confidence"] = rule["success_count"] / rule["applied_count"]
                
                # Save to disk
                with open(self.rules_file, "w") as f:
                    json.dump(self.rules, f, indent=2)
                
                break
    
    def get_session_summary(self) -> Dict:
        """Get summary of current session"""
        # Read session log
        entries = []
        if self.session_log_file.exists():
            with open(self.session_log_file) as f:
                for line in f:
                    entry = json.loads(line)
                    if entry.get("session_id") == self.current_session_id:
                        entries.append(entry)
        
        # Count events
        event_counts = defaultdict(int)
        for entry in entries:
            event_counts[entry["event"]] += 1
        
        return {
            "session_id": self.current_session_id,
            "total_events": len(entries),
            "event_breakdown": dict(event_counts),
            "lessons_learned": len([e for e in entries if e["event"] == "lesson_learned"]),
            "rules_created": len([e for e in entries if e["event"] == "rule_created"])
        }
    
    def save_state(self):
        """Save all in-memory state to disk"""
        # Lessons
        with open(self.lessons_file, "w") as f:
            json.dump(dict(self.lessons), f, indent=2)
        
        # Rules
        with open(self.rules_file, "w") as f:
            json.dump(self.rules, f, indent=2)
        
        # Log session end
        self._append_session_log({
            "event": "session_end",
            "summary": self.get_session_summary()
        })
        
        print(f"💾 Memory state saved")
    
    def query_history(self, event_type: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Query session log history"""
        entries = []
        
        if not self.session_log_file.exists():
            return entries
        
        with open(self.session_log_file) as f:
            for line in f:
                entry = json.loads(line)
                
                if event_type and entry.get("event") != event_type:
                    continue
                
                entries.append(entry)
                
                if len(entries) >= limit:
                    break
        
        return entries
    
    def get_statistics(self) -> Dict:
        """Get memory system statistics"""
        total_lessons = sum(len(lessons) for lessons in self.lessons.values())
        
        return {
            "total_lessons": total_lessons,
            "lesson_categories": len(self.lessons),
            "total_rules": len(self.rules),
            "active_rules": len([r for r in self.rules if r["confidence"] > 0.5]),
            "current_session": self.current_session_id,
            "session_summary": self.get_session_summary()
        }
    
    def export_knowledge_base(self, output_file: Path):
        """Export entire knowledge base for backup/sharing"""
        knowledge_base = {
            "exported_at": datetime.utcnow().isoformat(),
            "lessons": dict(self.lessons),
            "rules": self.rules,
            "statistics": self.get_statistics()
        }
        
        with open(output_file, "w") as f:
            json.dump(knowledge_base, f, indent=2)
        
        print(f"📦 Knowledge base exported to {output_file}")
    
    def import_knowledge_base(self, input_file: Path):
        """Import knowledge base from file"""
        with open(input_file) as f:
            knowledge_base = json.load(f)
        
        # Merge lessons
        for category, lessons in knowledge_base.get("lessons", {}).items():
            self.lessons[category].extend(lessons)
        
        # Merge rules (avoid duplicates)
        existing_rules = {r["rule"] for r in self.rules}
        for rule in knowledge_base.get("rules", []):
            if rule["rule"] not in existing_rules:
                self.rules.append(rule)
        
        # Save merged data
        self.save_state()
        
        print(f"📥 Knowledge base imported from {input_file}")
