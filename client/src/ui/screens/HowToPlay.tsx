import { Screen } from '../common';

export function HowToPlay({ back }: { back: () => void }) {
  return (
    <Screen title="Field Manual" back={back} wide>
      <div className="setup-grid manual">
        <section>
          <h3>Objective</h3>
          <p>Destroy every enemy structure (and their Mobile HQ) while keeping your own base alive.</p>
          <h3>Getting started</h3>
          <ol>
            <li>Select your <b>Mobile HQ Vehicle</b> and press <b>Deploy</b> (D) to create a Command Center.</li>
            <li>Build a <b>Power Plant</b>, then an <b>Ore Refinery</b> — it comes with a free Harvester.</li>
            <li>Build <b>Barracks</b> and a <b>War Factory</b> to train your army.</li>
            <li>Finished structures show <b>READY</b> — click them, then place them near your base.</li>
            <li>Keep power above usage: low power halves production and weakens defenses.</li>
            <li>Capture neutral <b>Ferrite Extractors</b> with Engineers for extra income.</li>
          </ol>
          <h3>Factions</h3>
          <p><b>Coalition</b>: tougher, self-repairing structures and heavy armor. <b>Directorate</b>: faster vehicles, quicker production and the Recon Sweep support power.</p>
        </section>
        <section>
          <h3>Desktop controls</h3>
          <table className="keys"><tbody>
            <tr><td>Left click / drag</td><td>Select unit / box-select</td></tr>
            <tr><td>Double-click</td><td>Select all of that type on screen</td></tr>
            <tr><td>Right click</td><td>Move / attack / harvest / enter (contextual), set rally point</td></tr>
            <tr><td>A + click</td><td>Attack-move</td></tr>
            <tr><td>S / D</td><td>Stop / Deploy</td></tr>
            <tr><td>Ctrl+1–9 · 1–9</td><td>Assign / recall control group (double-tap to jump)</td></tr>
            <tr><td>Arrows · screen edge · middle-drag</td><td>Scroll camera</td></tr>
            <tr><td>Mouse wheel</td><td>Zoom</td></tr>
            <tr><td>Z X C V</td><td>Build tabs · Q W E R T Y build items</td></tr>
            <tr><td>H / Space</td><td>Center on selection or base</td></tr>
            <tr><td>Esc / P</td><td>Cancel · Pause menu</td></tr>
          </tbody></table>
          <h3>Touch controls</h3>
          <table className="keys"><tbody>
            <tr><td>Tap</td><td>Select · with units selected: move / attack / harvest</td></tr>
            <tr><td>Double-tap a unit</td><td>Select all of that type on screen</td></tr>
            <tr><td>Long-press + drag</td><td>Box-select (or use the ▢ button)</td></tr>
            <tr><td>Drag</td><td>Pan the camera</td></tr>
            <tr><td>Pinch</td><td>Zoom</td></tr>
            <tr><td>Build button</td><td>Open production drawer · when READY tap to place, drag to position, ✔ to confirm</td></tr>
          </tbody></table>
        </section>
      </div>
    </Screen>
  );
}
