import { useState } from "react";

export default function AthleteProfileSettingsCard({
  ageYears,
  sex,
  saving,
  onSaveCalorieProfile,
}: {
  ageYears: number | null;
  sex: "male" | "female" | null;
  saving: boolean;
  onSaveCalorieProfile: (ageYears: number | null, sex: "male" | "female" | null) => Promise<boolean>;
}) {
  const [ageDraft, setAgeDraft] = useState(ageYears == null ? "" : String(ageYears));
  const [sexDraft, setSexDraft] = useState<"male" | "female" | "">(sex ?? "");
  const parsedAge = ageDraft === "" ? null : Number(ageDraft);
  const ageIsValid = parsedAge == null || (Number.isInteger(parsedAge) && parsedAge >= 10 && parsedAge <= 100);
  const normalizedAge = ageIsValid ? parsedAge : ageYears;
  const normalizedSex = sexDraft === "" ? null : sexDraft;
  const changed = normalizedAge !== ageYears || normalizedSex !== sex;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ageIsValid || !changed) return;
    await onSaveCalorieProfile(normalizedAge, normalizedSex);
  };

  return (
    <div className="athlete-settings-card">
      <div>
        <div className="panel-head">Profil de calcul</div>
        <p className="athlete-settings-intro">
          Âge et sexe, facultatifs : permettent une estimation calorique plus précise (formule Keytel,
          basée sur la FC) quand Strava ne fournit pas l'énergie et qu'une FC moyenne est disponible.
          Sinon FabRun retombe sur une estimation générique par intensité. Le poids utilisé pour ces
          calculs vient directement de ton profil Strava.
        </p>
      </div>

      <form className="athlete-calorie-profile" onSubmit={submit}>
        <div className="athlete-calorie-profile-row">
          <label>
            Âge
            <input
              type="number"
              min="10"
              max="100"
              step="1"
              inputMode="numeric"
              value={ageDraft}
              placeholder="ex. 35"
              disabled={saving}
              aria-invalid={!ageIsValid}
              onChange={(event) => setAgeDraft(event.target.value)}
            />
          </label>
          <label>
            Sexe
            <select
              value={sexDraft}
              disabled={saving}
              onChange={(event) => setSexDraft(event.target.value as "male" | "female" | "")}
            >
              <option value="">Non précisé</option>
              <option value="female">Féminin</option>
              <option value="male">Masculin</option>
            </select>
          </label>
          <button className="btn btn-secondary" type="submit" disabled={saving || !ageIsValid || !changed}>
            {saving ? "Enregistrement…" : "Enregistrer le profil"}
          </button>
        </div>
        {!ageIsValid && <p className="field-error">L’âge doit être compris entre 10 et 100 ans.</p>}
      </form>
    </div>
  );
}
