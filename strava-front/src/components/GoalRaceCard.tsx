import { useState } from "react";
import type { GoalRace, GoalRaceInput, PredictionResponse } from "../api";

const fmtTime = (sec: number) => {
  if (!sec || sec <= 0) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

const fmtDate = (value: string) => {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};

function daysUntil(targetDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${targetDate}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// Same Riegel formula as Services/PredictionMath.cs, applied client-side to
// each goal's exact distance rather than only the 4 preset race distances
// the backend precomputes.
function predictSeconds(referenceTimeSec: number, referenceKm: number, targetKm: number, exponent: number): number {
  return Math.round(referenceTimeSec * Math.pow(targetKm / referenceKm, exponent));
}

type Draft = { label: string; distanceKm: number; targetDate: string };
const emptyDraft: Draft = { label: "", distanceKm: 10, targetDate: "" };

function GoalForm({
  initial,
  onSubmit,
  onCancel,
  saving,
  canCancel,
}: {
  initial: Draft;
  onSubmit: (draft: Draft) => Promise<boolean>;
  onCancel: () => void;
  saving: boolean;
  canCancel: boolean;
}) {
  const [label, setLabel] = useState(initial.label);
  const [distanceKm, setDistanceKm] = useState(initial.distanceKm);
  const [targetDate, setTargetDate] = useState(initial.targetDate);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!label.trim() || !targetDate || !(distanceKm > 0)) return;
    await onSubmit({ label: label.trim(), distanceKm, targetDate });
  };

  return (
    <form className="goal-race-form" onSubmit={submit}>
      <label>
        Nom de la course
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="ex: 20 km de Bruxelles"
          maxLength={80}
          required
        />
      </label>
      <label>
        Distance (km)
        <input
          type="number"
          min={0.1}
          max={500}
          step={0.1}
          value={distanceKm}
          onChange={(event) => setDistanceKm(Number(event.target.value))}
          required
        />
      </label>
      <label>
        Date
        <input
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
          required
        />
      </label>
      <div className="goal-race-actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
        {canCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={saving}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

function GoalTile({
  race,
  predictions,
  onEdit,
  onDelete,
  disabled,
}: {
  race: GoalRace;
  predictions: PredictionResponse | null;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const days = daysUntil(race.targetDate);
  const ref = predictions?.reference;
  const predictedSec =
    ref && ref.timeSec > 0 && ref.distanceKm > 0
      ? predictSeconds(ref.timeSec, ref.distanceKm, race.distanceKm, predictions?.exponentUsed ?? 1.06)
      : null;

  return (
    <div className="goal-race-item">
      <div className="goal-race-summary">
        <div className="goal-race-name">{race.label}</div>
        <div className="goal-race-meta">
          {race.distanceKm} km • {fmtDate(race.targetDate)}
        </div>
      </div>
      <div className="predictions-grid goal-race-grid">
        <div className="prediction-tile">
          <div className="prediction-label">{days >= 0 ? "Jours restants" : "Course passée"}</div>
          <div className="prediction-value">{days >= 0 ? days : "—"}</div>
        </div>
        <div className="prediction-tile">
          <div className="prediction-label">Estimation actuelle</div>
          <div className="prediction-value">{predictedSec ? fmtTime(predictedSec) : "—"}</div>
        </div>
      </div>
      {!predictedSec && (
        <p className="prediction-hint">Pas encore assez de données de performance pour estimer ce temps.</p>
      )}
      <div className="goal-race-actions">
        <button className="btn btn-secondary" type="button" onClick={onEdit} disabled={disabled}>
          Modifier
        </button>
        <button className="btn btn-secondary" type="button" onClick={onDelete} disabled={disabled}>
          Supprimer l'objectif
        </button>
      </div>
    </div>
  );
}

export default function GoalRaceCard({
  goalRaces,
  predictions,
  onAdd,
  onUpdate,
  onDelete,
  saving,
}: {
  goalRaces: GoalRace[];
  predictions: PredictionResponse | null;
  onAdd: (draft: GoalRaceInput) => Promise<boolean>;
  onUpdate: (id: string, draft: GoalRaceInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  saving: boolean;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(goalRaces.length === 0 ? "new" : null);
  const sorted = [...goalRaces].sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  return (
    <>
      <div className="panel-head">Objectifs course</div>
      <div className="goal-race-list">
        {sorted.map((race) =>
          editingId === race.id ? (
            <GoalForm
              key={race.id}
              initial={race}
              saving={saving}
              canCancel
              onCancel={() => setEditingId(null)}
              onSubmit={async (draft) => {
                const saved = await onUpdate(race.id, draft);
                if (saved) setEditingId(null);
                return saved;
              }}
            />
          ) : (
            <GoalTile
              key={race.id}
              race={race}
              predictions={predictions}
              disabled={saving}
              onEdit={() => setEditingId(race.id)}
              onDelete={() => void onDelete(race.id)}
            />
          )
        )}
      </div>

      {editingId === "new" ? (
        <GoalForm
          initial={emptyDraft}
          saving={saving}
          canCancel={goalRaces.length > 0}
          onCancel={() => setEditingId(null)}
          onSubmit={async (draft) => {
            const saved = await onAdd(draft);
            if (saved) setEditingId(null);
            return saved;
          }}
        />
      ) : (
        <button
          className="btn btn-secondary goal-race-add"
          type="button"
          onClick={() => setEditingId("new")}
          disabled={saving}
        >
          + Ajouter un objectif
        </button>
      )}
    </>
  );
}
