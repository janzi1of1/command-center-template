// 21-Day Military Calisthenics Plan (MadMuscles) — no equipment, at-home.
// Transcribed from Janzi's PDF; drives the FIELD PT panel in the Command Center.

export type Exercise = { name: string; scheme: string };
export type WorkoutDay = { day: number; rest?: boolean; exercises: Exercise[] };

export const WORKOUT_PLAN_NAME = "21-DAY MILITARY CALISTHENICS";
export const WORKOUT_PLAN_LEN = 21;

const rest = (day: number): WorkoutDay => ({ day, rest: true, exercises: [] });

export const WORKOUT_PLAN: WorkoutDay[] = [
  { day: 1, exercises: [
    { name: "Tactical Jacks", scheme: "3×10" },
    { name: "Squats", scheme: "2×10" },
    { name: "High Knees", scheme: "4×10" },
  ] },
  { day: 2, exercises: [
    { name: "Push-Ups", scheme: "2×5" },
    { name: "Military Lunges", scheme: "10 each leg" },
    { name: "Tactical Crunches", scheme: "2×20" },
  ] },
  { day: 3, exercises: [
    { name: "Low Crawl", scheme: "2×10" },
    { name: "Tactical March", scheme: "4×10" },
    { name: "Wall Crunches", scheme: "2×10" },
  ] },
  rest(4),
  { day: 5, exercises: [
    { name: "Burpees", scheme: "2×3" },
    { name: "Tactical Squats", scheme: "2×10" },
    { name: "Knee-to-Elbow Raises", scheme: "2×10" },
  ] },
  { day: 6, exercises: [
    { name: "Wide-Grip Push-Ups", scheme: "2×4" },
    { name: "Sit-Ups", scheme: "3×5" },
    { name: "Tactical Jacks", scheme: "4×10" },
  ] },
  { day: 7, exercises: [
    { name: "Mountain Climbers", scheme: "5×5" },
    { name: "Squat Pulses", scheme: "5×5" },
    { name: "High Knees", scheme: "5×10" },
  ] },
  rest(8),
  { day: 9, exercises: [
    { name: "Tactical Jacks", scheme: "4×10" },
    { name: "Squats", scheme: "5×5" },
    { name: "Push-Ups", scheme: "2×6" },
  ] },
  { day: 10, exercises: [
    { name: "Military Lunges", scheme: "12 each leg" },
    { name: "Tactical Crunches", scheme: "5×5" },
    { name: "Tactical March", scheme: "6×10" },
  ] },
  { day: 11, exercises: [
    { name: "Diamond Push-Ups", scheme: "2×3" },
    { name: "Wall Crunches", scheme: "5×5" },
    { name: "High Knees", scheme: "6×10" },
  ] },
  rest(12),
  { day: 13, exercises: [
    { name: "Burpees", scheme: "2×4" },
    { name: "Mountain Climbers", scheme: "3×10" },
    { name: "Sit-Ups", scheme: "2×10" },
  ] },
  { day: 14, exercises: [
    { name: "Wide-Grip Push-Ups", scheme: "2×5" },
    { name: "Tactical Squats", scheme: "5×5" },
    { name: "Knee-to-Elbow Raises", scheme: "5×5" },
  ] },
  { day: 15, exercises: [
    { name: "Shoulder-Tap Push-Ups", scheme: "2×6" },
    { name: "Tactical March", scheme: "7×10" },
    { name: "Squat Pulses", scheme: "3×10" },
  ] },
  rest(16),
  { day: 17, exercises: [
    { name: "Push-Ups", scheme: "3×5" },
    { name: "Military Lunges", scheme: "2×7 each leg" },
    { name: "Tactical Crunches", scheme: "3×10" },
  ] },
  { day: 18, exercises: [
    { name: "Wide-Grip Push-Ups", scheme: "2×6" },
    { name: "Low Crawl", scheme: "5×5" },
    { name: "High Knees", scheme: "7×10" },
  ] },
  { day: 19, exercises: [
    { name: "Burpees", scheme: "2×5" },
    { name: "Mountain Climbers", scheme: "2×20" },
    { name: "Wall Crunches", scheme: "3×10" },
  ] },
  rest(20),
  { day: 21, exercises: [
    { name: "Tactical Jacks", scheme: "5×10" },
    { name: "Push-Ups", scheme: "5×5" },
    { name: "Military Lunges", scheme: "3×5 each leg" },
  ] },
];

export function workoutForDay(day: number): WorkoutDay {
  const idx = ((day - 1) % WORKOUT_PLAN_LEN + WORKOUT_PLAN_LEN) % WORKOUT_PLAN_LEN;
  return WORKOUT_PLAN[idx];
}
export function weekOfDay(day: number): number {
  return Math.floor(((day - 1) % WORKOUT_PLAN_LEN) / 7) + 1; // 1..3
}
