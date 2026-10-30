

"use client";



import { useState } from "react";

import type {

  TestCase,

  GenerationResult,

} from "@/lib/test-generator-schema";



type ExecutionResult = {
  id: string;
  title: string;
  status: "PASSED" | "FAILED" | "MANUAL" | "BLOCKED";
  reason: string | null;
  assertions: Array<{ action: string; status: "PASSED" | "FAILED"; detail: string }>;
  navigation: {
    status: "PASSED" | "FAILED" | "SKIPPED";
    httpStatus: number | null;
    finalUrl: string;
    error: string | null;
  };
  diagnostics: {
    consoleErrors: string[];
    pageErrors: string[];
    failedRequests: string[];
    httpFailures: string[];
  };
  screenshot: string | null;
};

type ExecutionResponse = {
  summary: { total: number; passed: number; failed: number; manual: number; blocked: number };
  navigation: {
    status: "PASSED" | "FAILED";
    httpStatus: number | null;
    pageTitle: string;
    finalUrl: string;
    pageInfo: { headingCount: number; linkCount: number; buttonCount: number; inputCount: number } | null;
    error: string | null;
    screenshot: string | null;
  };
  diagnostics: {
    consoleErrors: string[];
    pageErrors: string[];
    failedRequests: string[];
    httpFailures: string[];
  };
  results: ExecutionResult[];
  error?: string;
};
export default function Home() {

  const [jiraTicket, setJiraTicket] = useState("");

  const [generatedTests, setGeneratedTests] = useState<TestCase[]>([]);

  const [appUrl, setAppUrl] = useState("");

  const [executionToken, setExecutionToken] = useState("");

  const [allowInteractions, setAllowInteractions] = useState(false);

  const [environment, setEnvironment] = useState("QA");

  const [testTypes, setTestTypes] = useState<string[]>([

    "Positive",

    "Negative",

    "Edge Cases",

  ]);



  const [message, setMessage] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);

  const [isRunning, setIsRunning] = useState(false);

  const [generation, setGeneration] =

    useState<GenerationResult | null>(null);

  const [execution, setExecution] =

    useState<ExecutionResponse | null>(null);

  const partialCoverage =
    generation?.coverage?.status === "partial" ? generation.coverage : null;



  const toggleTest = (type: string) => {

    setTestTypes((current) =>

      current.includes(type)

        ? current.filter((item) => item !== type)

        : [...current, type]

    );

  };



  const handleGenerate = async () => {

    if (!jiraTicket.trim()) {

      setMessage("Please paste a Jira ticket and acceptance criteria.");

      return;

    }



    if (testTypes.length === 0) {

      setMessage("Please select at least one test type.");

      return;

    }



    setIsGenerating(true);

    setGeneration(null);

    setGeneratedTests([]);

    setExecution(null);

    setMessage("Generating test cases with local AI. This may take a moment...");



    try {

      const response = await fetch("/api/generate", {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

        },

        body: JSON.stringify({

          ticket: jiraTicket,
          selectedTypes: testTypes,

        }),

      });



      const data = await response.json();



      if (!response.ok) {

        throw new Error(

          data.error || `Generation failed: ${response.status}`

        );

      }



      const result = data as GenerationResult;



      const selectedTests = result.testCases.filter((test) =>

        testTypes.includes(test.type)

      );



      setGeneration(result);

      setGeneratedTests(selectedTests);



      setMessage(

        `${selectedTests.length} test cases generated for ${environment}. ` +

        `Method: ${result.generationMethod === "ai"

          ? "Local AI"

          : "Template fallback"

        }.`

      );

    } catch (error) {

      setMessage(

        error instanceof Error

          ? `Generation failed: ${error.message}`

          : "An unexpected error occurred during generation."

      );

    } finally {

      setIsGenerating(false);

    }

  };



  const handleRunBrowserTest = async () => {
    if (generatedTests.length === 0) {
      setMessage("Generate test cases before starting browser execution.");
      return;
    }
    if (!appUrl.trim()) {
      setMessage("Please enter your application URL.");
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(appUrl);
    } catch {
      setMessage("Please enter a valid application URL.");
      return;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      setMessage("Only HTTP and HTTPS URLs are supported.");
      return;
    }

    setIsRunning(true);
    setExecution(null);
    setMessage("Running generated test cases with Playwright...");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (executionToken.trim()) {
        headers.Authorization = `Bearer ${executionToken.trim()}`;
      }
      const response = await fetch("/api/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({
          url: parsedUrl.toString(),
          testCases: generatedTests,
          allowInteractions,
        }),
      });

      const data = (await response.json()) as ExecutionResponse;
      if (!response.ok) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }

      setExecution(data);
      setMessage(
        `Execution report for ${environment}: ${data.summary.passed} passed, ` +
        `${data.summary.failed} failed, ${data.summary.manual} manual, ` +
        `${data.summary.blocked} blocked.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Execution failed: ${error.message}`
          : "An unexpected error occurred during execution.",
      );
    } finally {
      setIsRunning(false);
    }
  };
  const handleExportReport = () => {
    if (!execution) return;

    const report = {
      reportName: "AI QA Platform Execution Report",
      generatedAt: new Date().toISOString(),
      environment,
      applicationUrl: appUrl,
      summary: execution.summary,
      navigation: execution.navigation,
      diagnostics: execution.diagnostics,
      results: execution.results,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `qa-execution-report-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  return (

    <main className="min-h-screen bg-slate-950 text-white">

      <header className="border-b border-slate-800 px-8 py-5">

        <div className="mx-auto flex max-w-6xl items-center gap-3">

          <div className="rounded-xl bg-blue-600 p-2 font-bold">

            QA

          </div>



          <div>

            <h1 className="text-xl font-bold">AI QA Platform</h1>

            <p className="text-sm text-slate-400">

              Intelligent test generation and automation

            </p>

          </div>



          <div className="ml-auto rounded-full border border-emerald-700 px-3 py-1 text-sm text-emerald-400">

            MVP

          </div>

        </div>

      </header>



      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[1.5fr_1fr]">

        <div>

          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-blue-400">

            AI-powered quality engineering

          </p>



          <h2 className="max-w-xl text-4xl font-bold leading-tight md:text-5xl">

            Test smarter.

            <br />

            Ship with confidence.

          </h2>



          <p className="mt-5 max-w-xl leading-7 text-slate-400">

            Validate Jira requirements against your QA and UAT

            applications. Generate test scenarios with local AI,

            then execute browser checks with Playwright.

          </p>



          <div className="mt-8 grid gap-4 sm:grid-cols-2">

            {[

              [

                "01",

                "Requirement analysis",

                "Turn acceptance criteria into test scenarios.",

              ],

              [

                "02",

                "AI test generation",

                "Generate scenarios based on the supplied requirements.",

              ],

              [

                "03",

                "Playwright execution",

                "Automate browser checks and collect evidence.",

              ],

              [

                "04",

                "Failure analysis",

                "Inspect browser errors and execution results.",

              ],

            ].map(([number, title, description]) => (

              <div

                key={number}

                className="rounded-xl border border-slate-800 bg-slate-900 p-5"

              >

                <p className="text-sm text-blue-400">{number}</p>

                <h3 className="mt-3 font-semibold">{title}</h3>

                <p className="mt-2 text-sm leading-6 text-slate-400">

                  {description}

                </p>

              </div>

            ))}

          </div>

        </div>



        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">

          <h3 className="text-xl font-bold">Create a test run</h3>



          <p className="mt-2 text-sm text-slate-400">

            Configure your requirement, application, and testing scope.

          </p>



          <form

            className="mt-6 space-y-5"

            onSubmit={(event) => {

              event.preventDefault();

              void handleGenerate();

            }}

          >

            <div>

              <label

                htmlFor="jira-ticket"

                className="mb-2 block text-sm font-medium"

              >

                Jira ticket and acceptance criteria

              </label>



              <textarea

                id="jira-ticket"

                value={jiraTicket}

                onChange={(event) => setJiraTicket(event.target.value)}

                placeholder="Paste the Jira ticket description, user story, and acceptance criteria..."

                rows={6}

                required

                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-blue-500"

              />

            </div>



            <div>

              <label

                htmlFor="app-url"

                className="mb-2 block text-sm font-medium"

              >

                Application URL

              </label>



              <input

                id="app-url"

                type="url"

                value={appUrl}

                onChange={(event) => setAppUrl(event.target.value)}

                placeholder="https\://your-qa-application.com"

                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-blue-500"

              />

            </div>
            <p className="text-xs leading-5 text-slate-400">
              Only public websites on standard HTTP or HTTPS ports are accepted. Local and private-network targets are blocked.
            </p>

            <div>
              <label htmlFor="execution-token" className="mb-2 block text-sm font-medium">
                Execution access token <span className="text-slate-500">(private deployments)</span>
              </label>
              <input
                id="execution-token"
                type="password"
                autoComplete="off"
                value={executionToken}
                onChange={(event) => setExecutionToken(event.target.value)}
                placeholder="Leave blank for local development"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-blue-500"
              />
              <p className="mt-2 text-xs text-slate-400">
                A deployed server requires a configured token; the value is sent only with the execution request.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-800 bg-amber-950/20 p-3">
              <input
                type="checkbox"
                checked={allowInteractions}
                onChange={(event) => setAllowInteractions(event.target.checked)}
                className="mt-1 accent-amber-500"
              />
              <span>
                <span className="block text-sm font-medium text-amber-200">
                  Allow generated cases to fill fields and click controls
                </span>
                <span className="mt-1 block text-xs text-amber-100/80">
                  Use only on an authorized QA/UAT target with synthetic data. Enabling interactions can submit forms and change page state.
                </span>
              </span>
            </label>



            <div>

              <label

                htmlFor="environment"

                className="mb-2 block text-sm font-medium"

              >

                Environment

              </label>



              <select

                id="environment"

                value={environment}

                onChange={(event) => setEnvironment(event.target.value)}

                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"

              >

                <option value="QA">QA</option>

                <option value="UAT">UAT</option>

              </select>

            </div>



            <div>

              <p className="mb-3 text-sm font-medium">Test coverage</p>



              <div className="space-y-3">

                {[

                  ["Positive", "Valid inputs and expected workflows"],

                  ["Negative", "Invalid inputs and error handling"],

                  ["Edge Cases", "Boundaries and unusual scenarios"],

                ].map(([type, description]) => (

                  <label

                    key={type}

                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 p-3"

                  >

                    <input

                      type="checkbox"

                      checked={testTypes.includes(type)}

                      onChange={() => toggleTest(type)}

                      className="mt-1 accent-blue-500"

                    />



                    <span>

                      <span className="block text-sm font-medium">

                        {type}

                      </span>

                      <span className="mt-1 block text-xs text-slate-400">

                        {description}

                      </span>

                    </span>

                  </label>

                ))}

              </div>

            </div>



            <button

              type="submit"

              disabled={isGenerating}

              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"

            >

              {isGenerating

                ? "Generating with Ollama..."

                : "Generate Test Cases"}

            </button>



            <button

              type="button"

              onClick={() => void handleRunBrowserTest()}

              disabled={isRunning}

              className="w-full rounded-lg border border-emerald-600 px-4 py-3 font-semibold text-emerald-400 transition hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"

            >

              {isRunning

                ? "Running Playwright..."

                : "Run Browser Test"}

            </button>



            {message && (

              <p

                role="status"

                aria-live="polite"

                className="break-words text-sm text-blue-300"

              >

                {message}

              </p>

            )}



            {generation && (

              <div className="space-y-3 border-t border-slate-800 pt-5">

                <div className="flex flex-wrap items-center justify-between gap-2">

                  <h3 className="text-lg font-bold">Generation Summary</h3>



                  <span className="rounded-full border border-slate-700 px-2 py-1 text-xs">

                    {generation.generationMethod === "ai"

                      ? "Local AI"

                      : "Template fallback"}

                  </span>

                </div>



                <p className="text-sm leading-6 text-slate-300">

                  {generation.summary}

                </p>

                {generation.coverage && (
                  <p className="text-xs text-slate-400" aria-label="Generated case counts">
                    Cases by category: {generation.coverage.caseCounts
                      .map(({ type, count }) => `${type}: ${count}`)
                      .join(" · ")}
                  </p>
                )}



                {partialCoverage && (
                  <p
                    role="alert"
                    aria-label="Generation coverage warning"
                    className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200"
                  >
                    <strong>Coverage needs review:</strong>{" "}
                    {[
                      ...partialCoverage.caseCounts
                        .filter(
                          ({ type, count }) =>
                            partialCoverage.failedTypes.includes(type) ||
                            (partialCoverage.underfilledTypes.includes(type) &&
                              count <
                                (partialCoverage.targetCaseCounts.find(
                                  (item) => item.type === type,
                                )?.count ?? 0)),
                        )
                        .map(({ type, count }) => {
                          const target =
                            partialCoverage.targetCaseCounts.find(
                              (item) => item.type === type,
                            )?.count ?? 0;
                          if (partialCoverage.failedTypes.includes(type)) {
                            if (generation.generationMethod === "template-fallback") {
                              const caseLabel = count === 1 ? "case" : "cases";
                              return `${type}: AI generation failed; ${count} template fallback ${caseLabel} shown`;
                            }
                            return `${type}: AI generation failed; no cases were generated for this category`;
                          }
                          return `${type}: ${count} of ${target} planned cases (below target)`;
                        }),
                      ...partialCoverage.notApplicableTypes.map(
                        (type) => `${type}: AI found no applicable scenarios`,
                      ),
                      ...(partialCoverage.targetWasCapped
                        ? ["planned case count was capped at 50; review criterion coverage"]
                        : []),
                      ...(partialCoverage.missingRequirementIds.length > 0
                        ? [
                            `No generated case is linked to: ${partialCoverage.missingRequirementIds.join(", ")}`,
                          ]
                        : []),
                    ].join("; ")}
                  </p>
                )}

                {generation.openQuestions.length > 0 && (

                  <div>

                    <h4 className="font-medium text-amber-300">

                      Open questions

                    </h4>



                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">

                      {generation.openQuestions.map((question, index) => (

                        <li key={index}>{question}</li>

                      ))}

                    </ul>

                  </div>

                )}

              </div>

            )}



            {generation?.requirementCoverage && generation.requirementCoverage.length > 0 && (
              <section className="space-y-3 border-t border-slate-800 pt-5" aria-label="Requirement traceability">
                <h3 className="text-lg font-bold">Requirement-to-test links</h3>
                <p className="text-xs leading-5 text-slate-400">
                  These links come from generated requirement references. Review each case to confirm it truly verifies the criterion; a link alone is not proof of full coverage.
                </p>
                <div className="space-y-2">
                  {generation.requirementCoverage.map((item) => (
                    <article key={item.requirementId} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-sm text-blue-300">{item.requirementId}</strong>
                        <span className={item.status === "linked" ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
                          {item.status === "linked" ? `Linked: ${item.testCaseIds.join(", ")}` : "No generated case is linked"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{item.criterion}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {generatedTests.length > 0 && (

              <div className="space-y-4 border-t border-slate-800 pt-5">

                <h3 className="text-lg font-bold">

                  Generated Test Cases ({generatedTests.length})

                </h3>



                {generatedTests.map((test) => (

                  <article

                    key={test.id}

                    className="rounded-lg border border-slate-700 bg-slate-950 p-4"

                  >

                    <div className="flex flex-wrap items-center justify-between gap-2">

                      <span className="text-sm font-semibold text-blue-400">

                        {test.id}

                      </span>



                      <div className="flex flex-wrap gap-2">

                        <span className="rounded-full border border-slate-700 px-2 py-1 text-xs">

                          {test.type}

                        </span>



                        <span className="rounded-full border border-slate-700 px-2 py-1 text-xs">

                          {test.priority}

                        </span>

                      </div>

                    </div>



                    <h4 className="mt-2 font-medium">{test.title}</h4>



                    <p className="mt-3 text-sm text-slate-400">

                      Requirement reference

                    </p>

                    <p className="mt-1 break-words text-sm text-slate-300">

                      {test.requirementRef}

                    </p>
                    <p className="mt-3 text-sm text-slate-400">Execution readiness</p>
                    {test.automationPlan?.mode === "automated" ? (
                      <p className="mt-1 text-sm text-emerald-300">
                        Automated plan · {test.automationPlan.actions.length} browser actions
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-amber-300">
                        Manual · {test.automationPlan?.mode === "manual" ? test.automationPlan.reason : "No supported action plan was provided."}
                      </p>
                    )}



                    <p className="mt-3 text-sm text-slate-400">

                      Preconditions

                    </p>

                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-300">

                      {test.preconditions.map((item, index) => (

                        <li key={index}>{item}</li>

                      ))}

                    </ul>



                    <p className="mt-3 text-sm text-slate-400">Steps</p>

                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-300">

                      {test.steps.map((step, index) => (

                        <li key={index}>{step}</li>

                      ))}

                    </ol>



                    {test.testData && (

                      <>

                        <p className="mt-3 text-sm text-slate-400">

                          Test data

                        </p>

                        <p className="mt-1 break-words text-sm text-slate-300">

                          {test.testData}

                        </p>

                      </>

                    )}



                    <p className="mt-3 text-sm text-slate-400">

                      Expected result

                    </p>

                    <p className="mt-1 text-sm text-slate-200">

                      {test.expectedResult}

                    </p>

                  </article>

                ))}

              </div>

            )}

          </form>

        </div>

      </section>



      {execution && (
        <section className="mx-auto max-w-6xl px-6 pb-12" aria-label="Browser execution report">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-bold">Test Case Execution Report</h2>
              <button
                type="button"
                onClick={handleExportReport}
                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold transition hover:bg-blue-500"
              >
                Export Report (JSON)
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Generated cases", execution.summary.total, "border-slate-700 text-white"],
                ["Passed", execution.summary.passed, "border-emerald-800 text-emerald-300"],
                ["Failed", execution.summary.failed, "border-red-800 text-red-300"],
                ["Manual", execution.summary.manual, "border-amber-800 text-amber-300"],
                ["Blocked", execution.summary.blocked, "border-slate-600 text-slate-300"],
              ].map(([label, value, color]) => (
                <div key={label} className={`rounded-lg border bg-slate-950 p-4 ${color}`}>
                  <p className="text-sm text-slate-400">{label}</p>
                  <p className="mt-2 text-3xl font-bold">{value}</p>
                </div>
              ))}
            </div>

            <section className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-5" aria-label="Navigation check">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Separate page navigation check</h3>
                <span className={execution.navigation.status === "PASSED" ? "rounded-full border border-emerald-700 px-3 py-1 text-sm text-emerald-300" : "rounded-full border border-red-700 px-3 py-1 text-sm text-red-300"}>
                  {execution.navigation.status}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-300">
                Navigation and browser diagnostics are reported separately; neither is counted as a generated test case.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <p className="text-sm text-slate-400">HTTP status: <span className="text-white">{execution.navigation.httpStatus ?? "No response"}</span></p>
                <p className="text-sm text-slate-400">Page title: <span className="text-white">{execution.navigation.pageTitle || "No title"}</span></p>
                <p className="break-all text-sm text-slate-400 sm:col-span-2">Final URL: <span className="text-white">{execution.navigation.finalUrl || "Not available"}</span></p>
              </div>
              {execution.navigation.error && <p className="mt-3 break-words text-sm text-red-300">{execution.navigation.error}</p>}
              {execution.navigation.pageInfo && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[["Headings", execution.navigation.pageInfo.headingCount], ["Links", execution.navigation.pageInfo.linkCount], ["Buttons", execution.navigation.pageInfo.buttonCount], ["Inputs", execution.navigation.pageInfo.inputCount]].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-800 p-3">
                      <p className="text-xs text-slate-400">{label}</p>
                      <p className="mt-1 text-xl font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {execution.navigation.screenshot && (
                <div className="mt-5">
                  <h4 className="mb-2 text-sm font-semibold">Navigation screenshot (not a test-case result)</h4>
                  <img src={execution.navigation.screenshot} alt="Screenshot from the separate navigation check" className="w-full rounded-lg border border-slate-700" />
                </div>
              )}
            </section>

            <section className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-5" aria-label="Browser diagnostics">
              <h3 className="text-lg font-semibold">Browser diagnostics</h3>
              <p className="mt-2 text-xs text-slate-400">Diagnostics are evidence and do not automatically determine functional case outcomes.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {([
                  ["Console errors", execution.diagnostics.consoleErrors],
                  ["JavaScript page errors", execution.diagnostics.pageErrors],
                  ["Failed network requests", execution.diagnostics.failedRequests],
                  ["HTTP error responses", execution.diagnostics.httpFailures],
                ] as Array<[string, string[]]>).map(([label, items]) => (
                  <div key={label} className="rounded-lg border border-slate-800 p-3">
                    <h4 className="text-sm font-semibold">{label} ({items.length})</h4>
                    {items.length === 0 ? (
                      <p className="mt-2 text-sm text-emerald-300">None captured.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {items.map((item, index) => <li key={index} className="break-words rounded bg-red-950/40 p-2 text-xs text-red-200">{item}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {execution.results.map((result) => {
              const generatedCase = generatedTests.find((testCase) => testCase.id === result.id);
              const statusColor = result.status === "PASSED"
                ? "border-emerald-700 text-emerald-300"
                : result.status === "FAILED"
                  ? "border-red-700 text-red-300"
                  : result.status === "MANUAL"
                    ? "border-amber-700 text-amber-300"
                    : "border-slate-600 text-slate-300";

              return (
                <article key={result.id} className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-400">{result.id}</p>
                      <h3 className="mt-1 text-lg font-semibold">{result.title}</h3>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-sm ${statusColor}`}>{result.status}</span>
                  </div>
                  {result.reason && <p className="mt-3 text-sm text-slate-300">{result.reason}</p>}
                  {generatedCase && <p className="mt-3 text-sm text-slate-400">Requirement: <span className="text-slate-200">{generatedCase.requirementRef}</span></p>}
                  <p className="mt-3 text-sm text-slate-400">
                    This case navigation: {result.navigation.status}
                    {result.navigation.httpStatus !== null ? ` · HTTP ${result.navigation.httpStatus}` : ""}
                  </p>
                  {result.assertions.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-semibold">Functional assertions</h4>
                      <ul className="mt-2 space-y-2">
                        {result.assertions.map((assertion, index) => (
                          <li key={`${assertion.action}-${index}`} className={`rounded-lg border p-3 text-sm ${assertion.status === "PASSED" ? "border-emerald-900 text-emerald-200" : "border-red-900 text-red-200"}`}>
                            <strong>{assertion.status}</strong> · {assertion.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.screenshot && (
                    <div className="mt-5">
                      <h4 className="mb-2 text-sm font-semibold">Screenshot from generated test execution</h4>
                      <img src={result.screenshot} alt={`Screenshot from ${result.id}`} className="w-full rounded-lg border border-slate-700" />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>

  );

}
