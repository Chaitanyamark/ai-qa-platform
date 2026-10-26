

"use client";



import { useState } from "react";

import type {

  TestCase,

  GenerationResult,

} from "@/lib/test-generator-schema";



type ExecutionResult = {

  id: string;

  title: string;

  status: "PASSED" | "FAILED";

  httpStatus: number | null;

  pageTitle: string;

  finalUrl: string;

  pageInfo: {

    headingCount: number;

    linkCount: number;

    buttonCount: number;

    inputCount: number;

  };

  consoleErrors: string[];

  pageErrors: string[];

  screenshot: string | null;

};



type ExecutionResponse = {

  summary: {

    total: number;

    passed: number;

    failed: number;

  };

  results: ExecutionResult[];

  error?: string;

};



export default function Home() {

  const [jiraTicket, setJiraTicket] = useState("");

  const [generatedTests, setGeneratedTests] = useState<TestCase[]>([]);

  const [appUrl, setAppUrl] = useState("");

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

    setMessage("Launching Playwright and checking the application...");



    try {

      const response = await fetch("/api/execute", {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

        },

        body: JSON.stringify({
          url: parsedUrl.toString(),
          environment,
          testCases: generatedTests,
        }),

      });



      const data = (await response.json()) as ExecutionResponse;



      if (!response.ok) {

        throw new Error(

          data.error || `Request failed: ${response.status}`

        );

      }



      setExecution(data);



      setMessage(

        `Browser check completed for ${environment}. ` +

        `${data.summary.passed} passed, ${data.summary.failed} failed.`

      );

    } catch (error) {

      setMessage(

        error instanceof Error

          ? `Execution failed: ${error.message}`

          : "An unexpected error occurred during execution."

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

        <section className="mx-auto max-w-6xl px-6 pb-12">

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">

            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-bold">
                Browser Execution Results
              </h2>
              <button
                type="button"
                onClick={handleExportReport}
                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold transition hover:bg-blue-500"
              >
                Export Report (JSON)
              </button>
            </div>



            <div className="mt-5 grid gap-4 sm:grid-cols-3">

              <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">

                <p className="text-sm text-slate-400">Total checks</p>

                <p className="mt-2 text-3xl font-bold">

                  {execution.summary.total}

                </p>

              </div>



              <div className="rounded-lg border border-emerald-800 bg-slate-950 p-4">

                <p className="text-sm text-slate-400">Passed</p>

                <p className="mt-2 text-3xl font-bold text-emerald-400">

                  {execution.summary.passed}

                </p>

              </div>



              <div className="rounded-lg border border-red-800 bg-slate-950 p-4">

                <p className="text-sm text-slate-400">Failed</p>

                <p className="mt-2 text-3xl font-bold text-red-400">

                  {execution.summary.failed}

                </p>

              </div>

            </div>



            {execution.results.map((result) => (

              <article

                key={result.id}

                className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-5"

              >

                <div className="flex flex-wrap items-center justify-between gap-3">

                  <div>

                    <p className="text-sm text-slate-400">{result.id}</p>

                    <h3 className="mt-1 text-lg font-semibold">

                      {result.title}

                    </h3>

                  </div>



                  <span

                    className={`rounded-full border px-3 py-1 text-sm ${result.status === "PASSED"

                        ? "border-emerald-700 text-emerald-400"

                        : "border-red-700 text-red-400"

                      }`}

                  >

                    {result.status}

                  </span>

                </div>



                <div className="mt-5 grid gap-3 sm:grid-cols-2">

                  <p className="text-sm text-slate-400">

                    HTTP status:{" "}

                    <span className="text-white">

                      {result.httpStatus ?? "No response"}

                    </span>

                  </p>



                  <p className="text-sm text-slate-400">

                    Page title:{" "}

                    <span className="text-white">

                      {result.pageTitle || "No title"}

                    </span>

                  </p>



                  <p className="break-all text-sm text-slate-400 sm:col-span-2">

                    Final URL:{" "}

                    <span className="text-white">{result.finalUrl}</span>

                  </p>

                </div>



                <h4 className="mt-5 font-semibold">Page elements</h4>



                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">

                  {[

                    ["Headings", result.pageInfo.headingCount],

                    ["Links", result.pageInfo.linkCount],

                    ["Buttons", result.pageInfo.buttonCount],

                    ["Inputs", result.pageInfo.inputCount],

                  ].map(([label, value]) => (

                    <div

                      key={label}

                      className="rounded-lg border border-slate-800 p-3"

                    >

                      <p className="text-xs text-slate-400">{label}</p>

                      <p className="mt-1 text-xl font-bold">{value}</p>

                    </div>

                  ))}

                </div>



                <h4 className="mt-5 font-semibold">Browser errors</h4>



                {result.consoleErrors.length === 0 &&

                  result.pageErrors.length === 0 ? (

                  <p className="mt-2 text-sm text-emerald-400">

                    No console or page errors captured.

                  </p>

                ) : (

                  <div className="mt-2 space-y-2">

                    {[...result.consoleErrors, ...result.pageErrors].map(

                      (error, index) => (

                        <p

                          key={index}

                          className="break-words rounded-lg bg-red-950/40 p-3 text-sm text-red-300"

                        >

                          {error}

                        </p>

                      )

                    )}

                  </div>

                )}



                {result.screenshot ? (

                  <div className="mt-6">

                    <h4 className="mb-3 font-semibold">

                      Page screenshot

                    </h4>

                    <img

                      src={result.screenshot}

                      alt="Screenshot captured by Playwright"

                      className="w-full rounded-lg border border-slate-700"

                    />

                  </div>

                ) : (

                  <p className="mt-4 text-sm text-amber-300">

                    Screenshot unavailable for this run.

                  </p>

                )}

              </article>

            ))}

          </div>

        </section>

      )}

    </main>

  );

}
