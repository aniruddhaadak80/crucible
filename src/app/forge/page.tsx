import { ForgeForm } from "@/components/ForgeForm";
import { Stage } from "@/components/parts";
import { GRADE_WEIGHTS, WEIGHT_SUM } from "@/lib/grade.ts";

export const metadata = {
  title: "Forge",
  description:
    "Charge a model failure, write exact assertions, and pour a benchmark task that grades deterministically.",
};

export default function ForgePage() {
  return (
    <div className="pour">
      <Stage label="Charge — describe the failure">
        <h1 className="display" style={{ fontSize: "clamp(2.4rem,6vw,4rem)", margin: "0 0 12px" }}>
          The forge
        </h1>
        <p className="lede">
          The best benchmarks come from a specific itch. Start from a failure you
          have actually watched happen, then write the assertions that would catch
          it — without asking another model whether the answer was acceptable.
        </p>

        <div style={{ marginTop: 26 }}>
          <ForgeForm />
        </div>
      </Stage>

      <Stage label="Charge — what the grade will charge you for">
        <p className="muted" style={{ maxWidth: "70ch", marginTop: 0 }}>
          The moment you save, the engine runs. These are the six weights it will
          apply, and they are published in every API response and every export so
          the number is never a black box.
        </p>
        <div className="scroll-x"><table className="rows">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">Weight</th>
              <th scope="col">How to raise it</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(GRADE_WEIGHTS).map(([id, weight]) => (
              <tr key={id}>
                <td className="data" style={{ fontSize: 12 }}>{id.replace(/_/g, " ")}</td>
                <td className="data">{weight.toFixed(2)}</td>
                <td className="muted">{LEVERS[id]}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="data">sum</td>
              <td className="data">{WEIGHT_SUM.toFixed(2)}</td>
              <td className="muted">Published, and asserted in the test suite.</td>
            </tr>
          </tfoot>
        </table></div>
      </Stage>
    </div>
  );
}

const LEVERS: Record<string, string> = {
  determinism: "Replace the heaviest judge_rubric with a regex or a JSON path.",
  discrimination: "Record a weaker model, or add a near-miss fixture.",
  fixture_seal: "Pin the revision, the seed, the temperature, and declare each input.",
  assertion_specificity: "Convert substring assertions into regex or JSON paths.",
  reproduction: "Name the model and pin its revision; prefer an ungated one.",
  cost_fit: "Shorten the prompt, or raise the budget to the measured figure.",
};