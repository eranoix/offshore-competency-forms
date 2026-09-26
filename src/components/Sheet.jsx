import { useEffect, useRef } from "react";
import { CRITERIA } from "../engine/generator";

/** A block edited straight on the paper. Deliberately not controlled by React
 *  on every keystroke (that throws the caret to the start); the node is written
 *  only when the text arrived from elsewhere: a new generation or the panel. */
function Editable({ text, generation, onChange, tag: Tag = "div", ...props }) {
  const ref = useRef(null);
  const seen = useRef(generation);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A new generation always wins — that is the whole point of writing again.
    const regenerated = seen.current !== generation;
    seen.current = generation;
    // Otherwise the panel may push text in, but never while the caret is in
    // here: rewriting the node under someone's hands throws them to the start.
    if (!regenerated && el === document.activeElement) return;
    if (el.innerText !== text) el.innerText = text;
  }, [generation, text]);
  return (
    <Tag
      {...props}
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(e) => onChange(e.currentTarget.innerText)}
    />
  );
}

const Banner = () => (
  <div className="bms">
    <div className="band">Business Management System</div>
    <div className="mark">
      northwind <b>offshore</b>
    </div>
  </div>
);

const Footer = ({ page }) => (
  <div className="foot">
    <div className="row">
      <span>NW-CAP-001 Rev: 1</span>
      <span>Date: 01-January-26</span>
      <span>Page {page} of 2</span>
    </div>
    <div className="cc">© Northwind Offshore</div>
  </div>
);

/** The two prose blocks carry their own controls: rewrite what is there, or
 *  write it again from the scores and the facts you supplied. */
function BlockTools({ kind, onAiBlock, busy }) {
  if (!onAiBlock) return null;
  return (
    <div className="block-tools" contentEditable={false}>
      <button onClick={() => onAiBlock(kind, "improve")} disabled={busy}>
        {busy ? "Writing…" : "Rewrite this"}
      </button>
      <button onClick={() => onAiBlock(kind, "write")} disabled={busy}>
        Write again
      </button>
    </div>
  );
}

export default function Sheet({
  doc,
  criteria,
  blocks,
  generation,
  onEdit,
  onAiBlock,
  aiBusy,
  page1Ref,
  sigRef,
}) {
  const trip = doc.start && doc.end ? `${fmt(doc.start)} to ${fmt(doc.end)}` : "";

  return (
    <>
      <div className="sheet">
        <div className="page" id="page1" ref={page1Ref}>
          {doc.draft && <div className="wm">DRAFT</div>}
          <Banner />
          <h1>Worksite Trip Feedback</h1>

          <div className="hdr">
            <div>
              <table>
                <tbody>
                  <tr>
                    <td className="lbl">Crew Member Name</td>
                    <td>{doc.crew}</td>
                  </tr>
                  <tr>
                    <td className="lbl">Position/Job Title</td>
                    <td>{doc.position}</td>
                  </tr>
                  <tr>
                    <td className="lbl">Worksite/Vessel</td>
                    <td>{doc.vessel}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <table>
                <tbody>
                  <tr>
                    <td className="lbl">Supervisor Name</td>
                    <td>{doc.supervisor}</td>
                  </tr>
                  <tr>
                    <td className="lbl">Position/Job Title</td>
                    <td>{doc.supervisorPosition}</td>
                  </tr>
                  <tr>
                    <td className="lbl">
                      Trip Duration
                      <br />
                      Date from/To
                    </td>
                    <td>{trip}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="gap" />
          <table>
            <tbody>
              <tr>
                <td style={{ width: "26%" }}>Work Scope</td>
                <td>
                  <Editable
                    tag="span"
                    text={doc.workScope}
                    generation={generation}
                    onChange={(v) => onEdit("workScope", v)}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <div className="gap" />
          <div>
            <span className="tag">Criteria</span>
          </div>
          <table className="scale">
            <tbody>
              <tr className="n">
                {[1, 2, 3, 4, 5].map((n) => (
                  <td key={n}>{n}</td>
                ))}
              </tr>
              <tr>
                <td>
                  Has <span className="nf">Not Performed</span> in all aspects of Performance
                  and/or, Values, and/or Competence
                </td>
                <td>
                  <span className="ri">Requires Improvement</span> in some aspects of
                  Performance and/or, Values, and/or Competence
                </td>
                <td>
                  Is <span className="ot">On Target</span> in most aspects of Performance,
                  Values, and Competence
                </td>
                <td>
                  Is <span className="at">Above Target</span> in most aspects of Performance,
                  Values, and Competence
                </td>
                <td>
                  Is <span className="os">Outstanding</span> in most aspects of Performance,
                  Values, and Competence
                </td>
              </tr>
            </tbody>
          </table>

          <div className="gap" />
          <table className="crit">
            <thead>
              <tr>
                <td>Criteria</td>
                {[1, 2, 3, 4, 5].map((n) => (
                  <td key={n}>{n}</td>
                ))}
                <td>Comments</td>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map(([key, label, second]) => (
                <tr key={key}>
                  <td>
                    {label}
                    {second && (
                      <>
                        <br />
                        {second}
                      </>
                    )}
                  </td>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <td key={n} className="x">
                      {criteria[key].score === n ? "X" : ""}
                    </td>
                  ))}
                  <Editable
                    tag="td"
                    text={criteria[key].comment}
                    generation={generation}
                    onChange={(v) => onEdit(`comment:${key}`, v)}
                  />
                </tr>
              ))}
            </tbody>
          </table>

          <div className="gap" />
          <div className="tag-row">
            <span className="tag">Supervisor Comments</span>
            <BlockTools kind="supervisor" onAiBlock={onAiBlock} busy={aiBusy === "supervisor"} />
          </div>
          <Editable
            className="boxed sup"
            text={blocks.supervisor}
            generation={generation}
            onChange={(v) => onEdit("supervisor", v)}
          />
          <table className="sig" ref={sigRef}>
            <tbody>
              <tr>
                <td>Signature</td>
                <td />
              </tr>
            </tbody>
          </table>

          <Footer page={1} />
        </div>
      </div>

      <div className="sheet">
        <div className="page">
          {doc.draft && <div className="wm">DRAFT</div>}
          <Banner />
          <div className="tag-row">
            <span className="tag">Crew Member Comments</span>
            <BlockTools kind="crew" onAiBlock={onAiBlock} busy={aiBusy === "crew"} />
          </div>
          <Editable
            className="boxed"
            style={{ minHeight: "52mm" }}
            text={blocks.crew}
            generation={generation}
            onChange={(v) => onEdit("crew", v)}
          />
          <table className="sig">
            <tbody>
              <tr>
                <td>Signature</td>
                <td />
              </tr>
            </tbody>
          </table>

          <div className="gap" />
          <table className="onshore">
            <tbody>
              <tr>
                <th colSpan={6}>For Onshore Department Use</th>
              </tr>
              <tr>
                <td style={{ width: "17%" }}>Date Received &amp; Reviewed</td>
                <td style={{ width: "13%" }} />
                <td style={{ width: "17%" }}>Further Action Required?</td>
                <td style={{ width: "17%" }} />
                <td style={{ width: "17%" }}>Skill Pool Planner Name</td>
                <td style={{ width: "19%" }} />
              </tr>
              <tr>
                <td>Date Received &amp; Reviewed</td>
                <td />
                <td>Further Action Required?</td>
                <td />
                <td>HR Advisor Name</td>
                <td />
              </tr>
            </tbody>
          </table>

          <div className="notes">
            <h2>Worksite Trip Feedback guidance notes;</h2>
            <p>
              The Worksite Trip Feedback document is for use by all Northwind Offshore direct hire crew -
              salaried and day rate only (Contractor personnel should utilise their equivalent
              Agency feedback document).
            </p>
            <p>
              This document should be utilised by crew as a minimum, to obtain feedback from
              their Supervisor following a first trip at a new worksite. Crew may request
              additional trip feedback from their Supervisor as required.{" "}
              <b>
                The worksite trip review does not replace the requirement to complete an annual
                appraisal.
              </b>
            </p>
            <p>
              The Supervisor should have a constructive conversation with the Crew Member about
              the trip and the feedback provided. Specific examples of performance/behaviours
              should be considered and noted in the comments section, in support of the scores
              provided.
            </p>
            <p>
              The Crew Member should make comment on the feedback received, in the relevant
              section within the document <b>before both parties sign off</b>. Once completed,
              the document should be sent to the relevant onshore Skill Pool Planner and HR
              Department.
            </p>
            <p>
              Should there be any questions regarding the use of this document or the assessment
              taking place, please contact your HR Department for further guidance.
            </p>
          </div>

          <Footer page={2} />
        </div>
      </div>
    </>
  );
}

function fmt(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
