---

editor_options:
  markdown:
    wrap: 72
---

# Linux memory acceptance: owner test pack

Use this pack for your own testing of stages 0–2. No additional participants are needed for owner acceptance. The separate representative-participant study stays unverified; these results must not be recorded as that study or as a comparative model-quality evaluation. Windows and macOS are deferred to your later sessions.

Use a separate profile so test preferences do not replace your everyday memories. From the repository folder on Linux, these commands create a marked private test profile and launch the development app:

``` sh
ourgeo_acceptance_profile=$(mktemp -d /tmp/ourgeo-memory-owner-XXXXXX)
printf 'synthetic-context-profile-v1\n' > "$ourgeo_acceptance_profile/.context-acceptance"
chmod 600 "$ourgeo_acceptance_profile/.context-acceptance"
printf 'Reuse this profile for restart checks: %s\n' "$ourgeo_acceptance_profile"
OURGEO_CONTEXT_TEST_PROFILE="$ourgeo_acceptance_profile" npm run dev
```

For restart checks, reuse the last command and the same profile path. To test the packaged build, replace `npm run dev` with `./dist/linux-unpacked/ourgeo`. Configure your usual assistant provider/model in this profile; ordinary settings and credentials are not copied into it.

Record the version displayed in the app, Linux distribution, launch method (`npm run dev`, unpacked app or AppImage), and assistant provider/model. Host remember/forget commands work without model inference; the answer checks use that assistant's usual processing destination. In **Settings → AI Assistant → Learning & context**, set both personal and project memory learning to **Remember only when I ask** and turn off preference learning from scratch conversations. This keeps unrelated suggestions out of the results. Use temporary projects and the synthetic data below.

## 1. See what an answer used

Start a new scratch chat. Ask: **Generate R code for 100 rows of dummy data.** Expand **Conversation only** or **Context** below the answer. Find the destination, delivery state and estimated input tokens; reported usage may be unavailable. Choose **Browse current context sources** and search for an open script.

**Pass:** you can distinguish the sources available for search from the excerpts selected for this answer and their delivery state. An unrelated dummy-data request has no automatically selected workspace evidence. Record any step you could not find without help, even if the final answer was correct.

## 2. Remember, correct and restart

Send **Remember that I prefer metric units.** This is a local host command and does not run a model. Open **Settings → AI Assistant → Memory Library → About you**. You can also open **Memory Library** below the assistant conversation. Confirm the remembered entry. Use **Edit** to replace it with **I prefer metric units and concise answers.** Choose **Save correction**, close the app normally and reopen it.

**Pass:** the correction survives restart and the original entry is no longer active. Ask **Write an R example to buffer points; use my preferred units.** Inspect the context receipt as well as the answer: any selected preference must be the current correction, rather than the old statement.

Also check direct entry in either Memory Library: under **Add a memory**, enter **Acceptance note: prefer readable names.** and choose **Remember about you**. This saves locally without running a model. Confirm it appears, then choose **Forget** on this additional entry. Keep the metric preference and its source conversation for test 5.

## 3. Keep project instructions separate

Save a temporary project as `memory-acceptance-A.ourgeoproj`. Open **Memory Library → Project**, enter **Use miles for this project.** under **Add a memory**, and choose **Remember on project save**. Save the project again. Check the library's **Project** tab and ask **Which distance units should this project use?** Start another chat in A and repeat that question. Then start a new workspace without loading a project.

**Pass:** A keeps its project instruction across chats; About you still contains your metric preference. The scratch workspace cannot retrieve A's miles instruction. Judge selected context and library scope separately from a model that guesses or answers incorrectly.

In A, use **Save As** to create `memory-acceptance-B.ourgeoproj`. Correct B's project instruction to **Use metres for this project.** Save B, then reopen A.

**Pass:** B's correction leaves A's saved miles instruction intact.

## 4. Exclude sources and column metadata

Run this directly in the R console of a temporary saved project:

``` r
memory_acceptance_data <- data.frame(
  public_value = c(1, 2, 3),
  private_marker = c("TEST_ONLY_A", "TEST_ONLY_B", "TEST_ONLY_C")
)
```

Wait for R to finish, then open **Settings → AI Assistant → Privacy & sources → Workspace column privacy**. Choose **Refresh workspace objects**, select `.GlobalEnv::memory_acceptance_data` under **Workspace object**, and tick `private_marker`. If column metadata was not cached, the control loads column names on selection. You do not need to open the Data Viewer or run the assistant to populate this control. Ask the assistant to describe the object's available schema, without executing R. Inspect any selected schema in its context receipt.

**Pass:** the excluded column's name/type are absent from retrieved schema; values are not included in schema context. The privacy control explains why assistant execution is paused while direct GUI/R use remains available.

Open the current-source browser from an answer, find an open synthetic script, choose **Exclude source**, and check the **Excluded** state filter. Repeat a request about that script. Allow it again using the source browser or **Settings → AI Assistant → Privacy & sources → Source exclusions**.

**Pass:** the source becomes excluded, is absent from future retrieved excerpts, and can be allowed again. Historical receipts may still show previously sent content. Do not copy the private marker into your question: user messages remain part of the conversation even when a source is excluded.

## 5. Forget and review conversation copies

In **Memory Library → About you**, find the preference created in test 2. Choose **Review transcript copies to forget**. Review the proposed copies, select only synthetic test messages you want removed, and confirm the review; this also forgets the memory. Separately use **Add a memory → Remember about you** to add **Acceptance note: prefer purple labels.** to About you and remove that entry with the ordinary **Forget** button. Restart and ask **What unit preference have I asked you to remember?** in a fresh scratch chat.

**Pass:** the forgotten entry is not active or selected for future retrieval; reviewed transcript copies are removed. The interface explains that old exports, backups and already transmitted content may still contain the statement. A guess from the model is not evidence of retrieval: inspect the receipt. Record whether the review controls were clear enough to use without assistance.

## 6. Export and reload a saved project

In B, use **Memory Library → Project → Add a memory** to add **Acceptance note: keep source data unchanged.** Choose **Remember on project save**, then save B. Choose **Copy readable export** in the library, paste the JSONL from the clipboard into a temporary text file, and inspect it. Close and reopen B; also open a copy of B from another temporary folder and choose the offered independent-copy option.

**Pass:** the saved project keeps its active instruction; the readable export contains the expected statement and scope. The independent copy can be edited and saved without changing B. Portable files should not authorise unrelated local folders or inherit an external memory connection.

## 7. Preserve an early instruction in a longer chat

In a new chat in B, send **For this chat, never modify source data. Buffer distance is exactly 100 metres; working CRS is EPSG:32610.** Make 20 ordinary follow-up requests about a synthetic point-buffer workflow, keeping the original object unchanged. End with **Give the final R code and repeat the distance, CRS and source-data constraint.**

**Pass:** the final code uses 100 metres and EPSG:32610 and writes a separate output. Check **Memory library → Conversation** for the original constraints. Record both a wrong answer and missing context if either occurs. This is one owner smoke test; it does not establish the specification's quality percentage.

If a request shows `BUDGET_LIMIT`, record the full message after the error code. The **Budgets** page contains estimated spending limits; the model’s token context window is configured under **Provider & model**. Retrieval depth is under **Learning & context**, and can also be changed in the assistant footer. The code alone is not enough to identify which limit was reached.

## Results to send back

Copy this table into your reply. Use **PASS**, **FAIL** or **NOT RUN**. For a failure, include the exact prompt, observed result and the first step where it diverged. For usability, note any control you could not find unaided. Optional screenshots should contain only the synthetic fixtures.

| Test | Result | Observed behaviour / difficulty |
|------------------------|------------------------|------------------------|
| 1\. Answer context and destination | I can see the destination and deliver state and the tokens sent. It doesn't seem that an exerts were sent which might make sense for a request for dummy data. | After your request I asked "Please open the spatial editor and plot some point that denote some major battles won by the Roman empire." and got "Error: BUDGET_LIMIT". THe context engine appears to have brought in  more context "Context: editor:openFile, editor:activateTab, editor:listTabs, map:addLayer, map:listObjects, connector:addServer, draw:addFeature, layout:addPanel, map:removeLayer, map:reorderLayers, map:selectLayer, map:setLayerOpacity, interface". Not sure why this exceeded limits. |
| 2\. Remember, correction and restart | Was able to make the memory. Was able to edit the memory. New memory was recalled after restart. | I didn't see the words memory library in the settings. The tab "Conversation", "About You" and "Project" are not distinct. It reads as one sentence "Conversation about you project". We need to make the tabs more distinctly tab. |
| 3\. Project/scratch isolation and Save As | Works as described. | The buttons "Edit", "Forget", etc read like text and don't look like buttons. This makes them hard to tell when one ends and the other begins. |
| 4\. Source and column privacy |  | I don't see "`.GlobalEnv::memory_acceptance_data"` so I can't test this. I just see "Choose an object with cached column meta-data" under Workspace object. Something appears inconsitent with your diretions and what was built. |
| 5\. Forgetting and transcript review |  |  |
| 6\. Export, reload and independent copy |  |  |
| 7\. Early constraints after 20 follow-ups |  |  |

Version:\
Linux distribution:\
Launch method:\
Assistant provider/model:\
Did any task require help? If so, which step?

After recording results, forget the synthetic test memories, close the temporary projects and remove their disposable files. Keep the results separate from the test fixtures. Installer checks, network capture, scale benchmarks and automated storage/security regression checks remain engineering work, rather than tests you need to perform manually in this pack.
