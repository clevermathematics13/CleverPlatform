-- Step 2 of 2: set the real draft_content. The literal text below (with
-- ZQBACKSLASHZQ standing in for backslash bytes) is treated as plain text
-- by Postgres until replace() swaps ZQBACKSLASHZQ back to chr(92) --
-- restoring the backslash BEFORE the ::jsonb cast, so the escaped quotes
-- parse correctly this time.
update assignment_templates
set draft_content = replace($draftpayload${
  "title": "Data, Samples, and the Shape of Truth",
  "subtitle": "Mastery Packet: IBDP Mathematics — Statistics Strand",
  "course": "IBDP Mathematics AA & AI, SL/HL",
  "syllabusTopics": "Topic 4.1 — Collection of data and sampling; Topic 4.2 — Presentation of data (grouped frequency tables, histograms, quartiles, box-and-whisker plots, cumulative frequency curves, skewness and outliers)",
  "prerequisites": "Ordering numerical data; basic percentages and fractions; calculating a simple mean; GDC list-entry skills",
  "materials": "GDC (Casio/TI/HP) or GeoGebra Classic; graph paper and ruler; a class-collected data set (heights or sleep hours) from the Part 0/Part 5 activities",
  "atl": "You will build representational fluency: the same data set read as a raw list, a grouped frequency table, a histogram, a cumulative frequency curve and a box-and-whisker plot — and learn to judge which representation, and which sampling design, best serves a given real-world question.",
  "compulsoryCore": "Part 0 and every question marked tier 1 (★) in Parts 1–4 form the compulsory core and must be completed by all students. Tier 2 (★★) questions consolidate standard fluency expected of every AA/AI student. Tier 3 (★★★) questions, including the full capstone investigation in Part 5, are optional extension for students aiming for the top achievement bands or preparing HL-style extended reasoning.",
  "plantedErrorIntro": "In Part 3 you will meet 'Chen's solution' — a fully worked, confidently written response to a box-and-whisker question that contains two genuine misconceptions. Your task is not to redo the work from scratch but to read it the way an examiner would: locate the exact line where the reasoning breaks down, name the misconception precisely using the vocabulary of this packet, and write a corrected version.",
  "instructions": [
    "Work through Parts 0–5 in order; each part assumes fluency with the skills developed in the previous part.",
    "For any question marked 'Show that' or 'Prove', full working must be shown — a correct final answer alone will not receive full marks.",
    "For technology tasks, record both your GDC/GeoGebra input (the data list and frequency list you entered) and the output the machine produced.",
    "Attempt all ★ questions first. ★★ questions consolidate standard practice; ★★★ questions are optional extension, best attempted once the compulsory core is secure.",
    "Use the contentTag and skillTag on each question to self-track which syllabus points and mathematical practices you have mastered."
  ],
  "commandTerms": [
    { "term": "State", "definition": "Give a specific name, value or other brief answer without explanation or calculation." },
    { "term": "Identify", "definition": "Provide an answer from a number of possibilities." },
    { "term": "Construct", "definition": "Display information in a diagrammatic or logical form." },
    { "term": "Interpret", "definition": "Use knowledge and understanding to recognise trends and draw conclusions from given information." },
    { "term": "Estimate", "definition": "Obtain an approximate value for an unknown quantity." },
    { "term": "Determine", "definition": "Obtain the only possible answer, showing relevant working." },
    { "term": "Show that", "definition": "Obtain the required result by a sequence of clear, logical steps, showing all working." },
    { "term": "Prove", "definition": "Use a sequence of logical steps to obtain the required result in a formal, general way." },
    { "term": "Comment on", "definition": "Give a judgment based on a given statement or the result of a calculation." },
    { "term": "Suggest", "definition": "Propose a solution, hypothesis or other possible course of action." },
    { "term": "Justify", "definition": "Give valid reasons or evidence to support an answer or conclusion." },
    { "term": "Evaluate", "definition": "Assess the implications and limitations of a method, result or claim." },
    { "term": "Sketch", "definition": "Represent by means of a diagram, giving a general idea of the required shape or relationship." },
    { "term": "Explain", "definition": "Give a detailed account including reasons or causes." }
  ],
  "tokProvocations": [
    { "id": "tok1", "body": "Mark Twain's line about 'lies, damned lies, and statistics' assumes numbers can be arranged to prove any conclusion. Yet the mathematics you use in this packet — the linear interpolation formula for quartiles, the $1.5 times ZQBACKSLASHZQ"IQRZQBACKSLASHZQ"$ outlier rule — is entirely fixed and non-negotiable. Where, precisely, does human judgement enter a statistical analysis if the formulas themselves leave no room for choice?" },
    { "id": "tok2", "body": "A grouped frequency table replaces every individual data point with a mid-interval value, so a person who spent 34 minutes on homework and one who spent 39 minutes are both recorded as '35' once grouped. Is a mean calculated from grouped data still a true statement about the real population, or has it quietly become a claim about a different, idealised population that never actually existed?" }
  ],
  "internationalMindedness": {
    "body": "The theory of statistical sampling used throughout this packet was substantially advanced by the Indian statistician Prasanta Chandra Mahalanobis, whose large-scale sample surveys (from the 1930s onward) became a model that national statistical offices worldwide still follow when they estimate population characteristics without a full census. Centuries earlier, the Islamic Golden Age scholar Abu Rayhan al-Biruni pioneered the systematic, repeated measurement and averaging of astronomical and geodesic quantities — an early expression of the same principle that underlies why we distrust a single data point and instead collect a representative sample. When you next read a claim expressed as 'x% of people believe…', remember that the mathematical machinery justifying that number was built across very different cultural and historical contexts."
  },
  "reflectionQuestions": [
    "Draw a concept map linking sampling method → data type → frequency table → histogram/cumulative frequency curve → five-number summary → box-and-whisker plot, labelling each arrow with the calculation or transformation involved.",
    "Statistics can produce an internally valid summary while still misrepresenting the population it claims to describe. Using at least one activity from this packet, explain how sampling decisions and grouping decisions both introduce 'invisible' choices into a supposedly objective statistical summary.",
    "Take a position: 'A well-constructed statistic is closer to a model than a fact.' Justify your position in 3–4 sentences, using vocabulary from this packet (e.g. estimate, mid-interval value, percentile, interpolation)."
  ],
  "sections": [
    {
      "heading": "Part 0 — Activating Prior Knowledge",
      "spotlight": {
        "title": "Estimate vs Determine: the epistemology of grouped data",
        "body": "Throughout this packet you will be asked to 'determine' a value from raw, ungrouped data (an exact answer exists and must be found) but to 'estimate' the same type of value — a mean, a median, a quartile — once that data has been grouped into class intervals. This is not sloppy language: once individual data points are replaced by mid-interval values or read from a graph, the true individual values are permanently lost, and only an approximation is mathematically possible. Recognising which command term applies tells you whether exactness is available or whether approximation is the honest, correct response."
      },
      "questions": [
        {
          "prompt": "Classify each variable as discrete or continuous.",
          "marks": 4,
          "tier": 1,
          "contentTag": "Topic 4.2 — Discrete vs continuous data",
          "skillTag": "Classification of variable types",
          "answer": "(a) discrete (b) continuous (c) discrete (d) continuous.",
          "subparts": [
            { "prompt": "The number of siblings a student has.", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Discrete vs continuous data", "skillTag": "Classification of variable types" },
            { "prompt": "The height of a tree, measured in metres.", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Discrete vs continuous data", "skillTag": "Classification of variable types" },
            { "prompt": "A person's shoe size.", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Discrete vs continuous data", "skillTag": "Classification of variable types" },
            { "prompt": "The time taken to run 100 m, measured with a stopwatch.", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Discrete vs continuous data", "skillTag": "Classification of variable types" }
          ]
        },
        {
          "prompt": "The following is the raw list of marks (out of 20) for 11 students: $14, 9, 18, 6, 15, 11, 20, 8, 13, 17, 10$. Order the data and hence state the minimum, the maximum and the median.",
          "marks": 3,
          "tier": 1,
          "contentTag": "Topic 4.2 — Five-number summary (prior knowledge)",
          "skillTag": "Ordering and locating central values",
          "answer": "Ordered: 6,8,9,10,11,13,14,15,17,18,20. Minimum = 6, maximum = 20, median (6th of 11 values) = 13.",
          "hint": "Write the list out in increasing order first — do not try to find the median from the unordered list."
        },
        {
          "prompt": "State the sampling method being described in each scenario.",
          "marks": 3,
          "tier": 1,
          "contentTag": "Topic 4.1 — Sampling methods",
          "skillTag": "Recall of definitions",
          "answer": "(a) convenience (b) simple random (c) systematic.",
          "subparts": [
            { "prompt": "A researcher stands outside one shop and surveys the first 30 people who walk past.", "marks": 1, "tier": 1, "contentTag": "Topic 4.1 — Sampling methods", "skillTag": "Recall of definitions" },
            { "prompt": "Every student's name is written on a slip of paper, the slips are placed in a box, and 20 are drawn out.", "marks": 1, "tier": 1, "contentTag": "Topic 4.1 — Sampling methods", "skillTag": "Recall of definitions" },
            { "prompt": "A researcher rolls a die, gets a 4, and then selects every 15th name on an alphabetical register starting from the 4th name.", "marks": 1, "tier": 1, "contentTag": "Topic 4.1 — Sampling methods", "skillTag": "Recall of definitions" }
          ]
        },
        {
          "prompt": "A data set contains $n = 40$ values, arranged in increasing order. State the position (as a value of $k$, the $k$th data point) that corresponds to the median, to $Q_1$ and to $Q_3$.",
          "marks": 2,
          "tier": 2,
          "contentTag": "Topic 4.2 — Percentile position",
          "skillTag": "Proportional reasoning",
          "answer": "Median is between the 20th and 21st values (average of these two); $Q_1$ is the 10th value (or between 10th/11th depending on convention); $Q_3$ is the 30th value (or between 30th/31st)."
        }
      ],
      "translationTable": {
        "caption": "From everyday language to statistical language",
        "rows": [
          { "informal": "I asked whoever was free to answer my survey", "formal": "Convenience sampling" },
          { "informal": "I gave every 10th customer on the till receipt a survey", "formal": "Systematic sampling" },
          { "informal": "The middle value when the data is placed in order", "formal": "The median ($Q_2$)" },
          { "informal": "The point below which a quarter of the data lies", "formal": "The first quartile ($Q_1$)" }
        ]
      }
    },
    {
      "heading": "Part 1 — Sampling: Conjecture and Investigation",
      "prerequisiteBox": {
        "items": [
          "Definitions of population and sample (Topic 4.1)",
          "Random selection means every member of the population has an equal probability of being chosen",
          "The five sampling types: simple, convenience, systematic, quota, stratified"
        ]
      },
      "questions": [
        {
          "prompt": "State the sampling method used in each scenario below.",
          "marks": 3,
          "tier": 1,
          "contentTag": "Topic 4.1 — Identifying sampling methods",
          "skillTag": "Pattern recognition in real contexts",
          "answer": "(a) quota (b) stratified (c) convenience.",
          "subparts": [
            { "prompt": "A market researcher is told to interview exactly 25 women and 25 men, selecting whoever is available in a shopping centre.", "marks": 1, "tier": 1, "contentTag": "Topic 4.1 — Identifying sampling methods", "skillTag": "Pattern recognition in real contexts" },
            { "prompt": "A pollster randomly selects voters so that the proportion from each political region matches the national population proportions exactly.", "marks": 1, "tier": 1, "contentTag": "Topic 4.1 — Identifying sampling methods", "skillTag": "Pattern recognition in real contexts" },
            { "prompt": "A student surveys only their own friendship group about phone usage.", "marks": 1, "tier": 1, "contentTag": "Topic 4.1 — Identifying sampling methods", "skillTag": "Pattern recognition in real contexts" }
          ]
        },
        {
          "prompt": "A school has 450 students: 180 in Year 10, 150 in Year 11 and 120 in Year 12. The principal wants a stratified sample of size 90 for a wellbeing survey. Determine how many students should be sampled from each year group.",
          "marks": 3,
          "tier": 2,
          "contentTag": "Topic 4.1 — Stratified sampling calculations",
          "skillTag": "Proportional allocation",
          "hint": "Multiply each stratum's population fraction by the total sample size, i.e. $(ZQBACKSLASHZQ"stratum sizeZQBACKSLASHZQ")/(ZQBACKSLASHZQ"population sizeZQBACKSLASHZQ") times ZQBACKSLASHZQ"sample sizeZQBACKSLASHZQ"$.",
          "answer": "Year 10: $180/450 times 90 = 36$. Year 11: $150/450 times 90 = 30$. Year 12: $120/450 times 90 = 24$. Check: $36+30+24=90$."
        },
        {
          "prompt": "Researcher A investigates average daily screen time using convenience sampling in the school cafeteria at lunchtime. Researcher B investigates the same question using stratified sampling across all year groups and genders. Conjecture which researcher is more likely to produce a valid estimate of the whole-school population parameter, and justify your conjecture.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.1 — Bias and validity",
          "skillTag": "Conjecture from qualitative reasoning",
          "answer": "Researcher B's stratified sample is more likely to be valid, because it deliberately represents every subgroup in proportion to its size in the population, reducing the risk that any one subgroup (e.g. students who eat lunch at a particular time or in a particular location) is over- or under-represented. Researcher A's convenience sample may systematically exclude students with different lunch habits, class schedules, or those who avoid the cafeteria, introducing selection bias."
        },
        {
          "prompt": "Suggest a sampling design, naming the type(s) of sampling used at each stage, for estimating the proportion of coral bleaching along a 500 km reef, given that only certain sections of the reef are accessible by boat.",
          "marks": 5,
          "tier": 3,
          "contentTag": "Topic 4.1 — Real-world sampling design",
          "skillTag": "Transfer of concept to novel context",
          "answer": "A reasonable design: divide the reef into equal-length sections (strata) based on known depth/accessibility zones, then within each accessible stratum use systematic sampling (e.g. every 200 m mark) to select dive sites, ensuring proportional representation from each stratum. This combines stratified sampling (to guarantee coverage of different reef zones) with systematic sampling (to achieve practical, evenly spaced selection within each zone), while acknowledging the limitation that inaccessible sections cannot be represented and this constitutes a source of potential bias that should be reported."
        }
      ],
      "translationTable": {
        "caption": "From media claims to statistical scrutiny",
        "rows": [
          { "informal": "ZQBACKSLASHZQ"Studies show coffee prevents cancerZQBACKSLASHZQ"", "formal": "A correlational claim requiring scrutiny of sample size, sampling method, and control for confounding variables" },
          { "informal": "ZQBACKSLASHZQ"9 out of 10 dentists recommend...ZQBACKSLASHZQ"", "formal": "Likely a convenience or self-selected sample of dentists, not necessarily representative of all dentists" },
          { "informal": "ZQBACKSLASHZQ"Scientists proved it worksZQBACKSLASHZQ"", "formal": "A single study's result is not 'proof'; replication and sampling validity must be checked before generalising" }
        ]
      }
    },
    {
      "heading": "Part 2 — Grouped Data, Frequency Distributions and Quartiles",
      "prerequisiteBox": {
        "items": [
          "Constructing frequency tables by tallying raw data",
          "Class interval, class width, lower/upper class boundary, mid-interval value",
          "Locating the position of the median in an ordered list"
        ]
      },
      "questions": [
        {
          "prompt": "Sixty students were timed (in minutes) doing homework and the raw times were grouped into the following frequency table.",
          "marks": 3,
          "tier": 1,
          "contentTag": "Topic 4.2 — Grouping raw data into class intervals",
          "skillTag": "Data organisation",
          "answer": "(a) Class width = 10 minutes for every class. (b) Boundaries: 0, 10, 20, 30, 40, 50, 60, 70. (c) Modal class is 30–40 minutes (frequency 18, the highest).",
          "subparts": [
            { "prompt": "State the class width used in the table: 0–10 (4), 10–20 (9), 20–30 (15), 30–40 (18), 40–50 (8), 50–60 (4), 60–70 (2).", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Grouping raw data into class intervals", "skillTag": "Data organisation" },
            { "prompt": "State the lower and upper boundaries of each class.", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Grouping raw data into class intervals", "skillTag": "Data organisation" },
            { "prompt": "Identify the modal class.", "marks": 1, "tier": 1, "contentTag": "Topic 4.2 — Grouping raw data into class intervals", "skillTag": "Data organisation" }
          ]
        },
        {
          "prompt": "Using the mid-interval values of the homework-time table above, estimate the mean time spent on homework, giving your answer to one decimal place.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.2 — Estimating mean from grouped data",
          "skillTag": "Weighted average calculation",
          "hint": "Use $macron(x) = (sum f x)/(sum f)$ with mid-interval values $x = 5, 15, 25, 35, 45, 55, 65$.",
          "answer": "$sum f x = 4(5)+9(15)+15(25)+18(35)+8(45)+4(55)+2(65) = 1870$. $sum f = 60$. $macron(x) = 1870/60 approx 31.2$ minutes."
        },
        {
          "prompt": "Show that the estimated mean calculated from a grouped frequency table can differ from the exact mean of the underlying raw data, using the small data set $2, 3, 3, 8, 9$ grouped into the classes $0$–$5$ and $5$–$10$.",
          "marks": 5,
          "tier": 2,
          "contentTag": "Topic 4.2 — Loss of information in grouping",
          "skillTag": "Show that / comparative calculation",
          "hint": "First compute the exact mean of $2,3,3,8,9$ directly, then group the data and recompute using mid-interval values, and compare the two results.",
          "answer": "Exact mean: $(2+3+3+8+9)/5 = 25/5 = 5$. Grouped: class $0$–$5$ has frequency 3 (mid-interval 2.5), class $5$–$10$ has frequency 2 (mid-interval 7.5). Estimated mean $= (3(2.5)+2(7.5))/5 = (7.5+15)/5 = 22.5/5 = 4.5$. Since $4.5 eq 5$, the estimate differs from the exact mean, confirming that grouping loses information."
        },
        {
          "prompt": "The number of matches per box was recorded for a sample, giving the discrete frequency table: value 2 (freq 4), 4 (freq 7), 6 (freq 8), 7 (freq 5), 10 (freq 2). Find $Q_1$, the median, $Q_3$ and the IQR.",
          "marks": 5,
          "tier": 2,
          "contentTag": "Topic 4.2 — Quartiles for discrete/frequency data",
          "skillTag": "Cumulative frequency position method",
          "answer": "$n=26$. Cumulative frequencies: 4, 11, 19, 24, 26. Median = mean of 13th and 14th values = 6. $Q_1$ = 7th value (median of first 13) = 4. $Q_3$ = 20th value (median of last 13) = 7. IQR $= 7 - 4 = 3$."
        },
        {
          "prompt": "Explain why a histogram representing classes of unequal width should use frequency density (frequency divided by class width) on the vertical axis rather than raw frequency, and sketch the shape of such a histogram for classes $0$–$10$ (freq 20), $10$–$15$ (freq 15), $15$–$30$ (freq 30).",
          "marks": 4,
          "tier": 3,
          "contentTag": "Topic 4.2 — Frequency density (extension)",
          "skillTag": "Conceptual generalisation",
          "answer": "If raw frequency were plotted against unequal class widths, wider bars would visually exaggerate how much data they contain purely because of their width, distorting the true distribution. Using frequency density $= ZQBACKSLASHZQ"frequencyZQBACKSLASHZQ"/ZQBACKSLASHZQ"class widthZQBACKSLASHZQ"$ makes the area of each bar (not its height) proportional to frequency, preserving a fair visual comparison. Densities here: $20/10=2$, $15/5=3$, $30/15=2$; the middle, narrower bar is tallest despite not having the highest frequency."
        }
      ],
      "geometricReading": {
        "body": "Notice the shift in representation: the algebraic formula $macron(x) = (sum f x)/(sum f)$ treats each mid-interval value as a stand-in for every data point in its class — geometrically, this is equivalent to concentrating the 'weight' of each histogram bar at its horizontal centre, as though each bar were replaced by a single point mass. The histogram itself is a geometric object whose bar areas (not merely heights, once class widths vary) encode frequency — the same information the algebraic frequency table encodes as a list of numbers."
      }
    },
    {
      "heading": "Part 3 — Box-and-Whisker Plots: Construction, Interpretation and Outliers",
      "prerequisiteBox": {
        "items": [
          "Five-number summary: minimum, $Q_1$, median, $Q_3$, maximum",
          "$ZQBACKSLASHZQ"IQRZQBACKSLASHZQ" = Q_3 - Q_1$",
          "Outlier fences: below $Q_1 - 1.5 times ZQBACKSLASHZQ"IQRZQBACKSLASHZQ"$ or above $Q_3 + 1.5 times ZQBACKSLASHZQ"IQRZQBACKSLASHZQ"$"
        ]
      },
      "questions": [
        {
          "prompt": "A data set of exam scores has five-number summary: minimum $= 42$, $Q_1 = 58$, median $= 67$, $Q_3 = 75$, maximum $= 93$. Construct the box-and-whisker plot (describe the position of every feature on a labelled number line).",
          "marks": 3,
          "tier": 1,
          "contentTag": "Topic 4.2 — Constructing box-and-whisker plots",
          "skillTag": "Representational transfer: summary → diagram",
          "answer": "A box drawn from 58 to 75 with an internal line at 67; a whisker from 42 to 58 and a whisker from 75 to 93, all on a number line scaled to include 42 through 93."
        },
        {
          "prompt": "Fifteen sprint times (seconds) are recorded, in order: $11.2, 11.5, 11.6, 11.8, 11.9, 12.0, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 13.0, 15.5$. Determine whether the data set contains any outliers, showing full working with the $1.5 times ZQBACKSLASHZQ"IQRZQBACKSLASHZQ"$ rule.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.2 — Outlier detection using the IQR rule",
          "skillTag": "Applying an algebraic rule/test",
          "answer": "$n=15$: median (8th value) $=12.2$. $Q_1$ (4th value of lower 7) $=11.8$. $Q_3$ (4th value of upper 7, i.e. 13th overall) $=12.6$. $ZQBACKSLASHZQ"IQRZQBACKSLASHZQ" = 12.6-11.8=0.8$. Upper fence $=12.6+1.5(0.8)=13.8$. Since $15.5 > 13.8$, this value is an outlier. Lower fence $=11.8-1.5(0.8)=10.6$; no value falls below this, so there is exactly one outlier: 15.5."
        },
        {
          "prompt": "Grace's five-number summary for hours of sleep is: min $4$, $Q_1=7$, median $=8$, $Q_3=9$, max $=11$. Jacob's is: min $4$, $Q_1=6$, median $=8$, $Q_3=9$, max $=12$. Comment on which student has a more consistent sleep routine and which distribution appears more skewed.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.2 — Interpreting comparative box plots",
          "skillTag": "Interpretation and comparison of spread",
          "answer": "Grace's IQR is $9-7=2$ compared to Jacob's $9-6=3$, and her whisker lengths ($3$ and $3$) are shorter/more balanced than Jacob's ($2$ and $4$), so Grace has a more consistent sleep routine. Jacob's longer upper whisker ($9$ to $12$, length 3) compared to his lower whisker ($4$ to $6$, length 2) suggests his data is positively skewed — he occasionally sleeps much more than usual, pulling the mean above the median."
        },
        {
          "prompt": "Chen was asked to construct and interpret a box-and-whisker plot for the sprint-time data of Question 3.2. Read Chen's solution below and identify the two errors in his reasoning, then write a corrected version. ZQBACKSLASHZQnZQBACKSLASHZQnChen's solution: 'Five-number summary: min $=11.2$, $Q_1=11.8$, median $=12.2$, $Q_3=12.6$, max $=15.5$. I drew the box from 11.8 to 12.6 with whiskers extending all the way from 11.2 to 15.5, since a box plot's whiskers always reach the minimum and maximum. Because the box looks roughly symmetric around the median, I conclude the data is approximately normally distributed.'",
          "marks": 5,
          "tier": 2,
          "contentTag": "Topic 4.2 — Common errors in box-and-whisker construction",
          "skillTag": "Error analysis",
          "hint": "Re-check Question 3.2's outlier calculation, and recall that 'approximately symmetric box' alone is not sufficient evidence for normality — the whisker lengths must also be considered.",
          "answer": "Error 1: Chen drew the upper whisker to the maximum (15.5), but 15.5 was shown in Q3.2 to be an outlier (it exceeds the upper fence of 13.8). The whisker should stop at the largest non-outlier value (13.0), with 15.5 marked separately as an outlier point. Error 2: Chen judged normality from box symmetry alone, but the whiskers must also be checked — even with a symmetric box, one very long or very short whisker (or, once corrected, the presence of an outlier) indicates skew rather than a normal distribution. A corrected conclusion would note that with the outlier removed the box is fairly symmetric, but the presence of the outlier itself suggests the underlying process (an injured runner) is not part of the same normal distribution as the rest of the data."
        },
        {
          "prompt": "Using a GDC or GeoGebra, enter the homework-time data from Part 2 as mid-interval values $ZQBACKSLASHZQZQBACKSLASHZQ{5,15,25,35,45,55,65ZQBACKSLASHZQZQBACKSLASHZQ}$ in one list with frequencies $ZQBACKSLASHZQZQBACKSLASHZQ{4,9,15,18,8,4,2ZQBACKSLASHZQZQBACKSLASHZQ}$ in a second list. Construct the box-and-whisker plot and record the five-number summary the machine displays. Compare this to the interpolated quartiles you will calculate by hand in Part 4, and comment on any difference.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.2 — Box-and-whisker plots via GDC/GeoGebra",
          "skillTag": "GDC as instrument of verification",
          "answer": "The GDC/GeoGebra will report a five-number summary based on the mid-interval values entered (e.g. $Q_1 = 25$, median $=35$, $Q_3=35$ or similar, depending on the machine's discrete quartile algorithm), which will differ from the linearly interpolated values found from the cumulative frequency curve in Part 4 (approximately $Q_1 approx 21.3$, median $approx 31.1$, $Q_3 approx 39.4$). This discrepancy illustrates that grouped-data quartiles are estimates whose exact value depends on the method (discrete position vs linear interpolation) chosen to compute them."
        },
        {
          "prompt": "A box-and-whisker plot for long-distance race times shows a short lower whisker and a long upper whisker, with the median close to $Q_1$. Justify, in one or two sentences, why the mean of this data set is likely greater than the median.",
          "marks": 3,
          "tier": 3,
          "contentTag": "Topic 4.2 — Skewness and measures of centre",
          "skillTag": "Connecting geometric and numerical representations",
          "answer": "The long upper whisker indicates a 'tail' of slower runners with unusually large times; these large values pull the arithmetic mean upward without moving the median (which only depends on rank position), so the mean exceeds the median — a hallmark of positive skew."
        }
      ],
      "geometricReading": {
        "body": "The numerical measure of skew (the sign of $ZQBACKSLASHZQ"meanZQBACKSLASHZQ" - ZQBACKSLASHZQ"medianZQBACKSLASHZQ"$) and the geometric appearance of the box-and-whisker plot (unequal whisker lengths, an off-centre median line within the box) are two representations of exactly the same underlying asymmetry in the data. Learning to read skew directly off the diagram, without recalculating the mean, is an example of representational fluency: recognising the same mathematical fact in a picture as quickly as in a number."
      }
    },
    {
      "heading": "Part 4 — Cumulative Frequency Curves: Proof, Percentiles and Application",
      "prerequisiteBox": {
        "items": [
          "Cumulative frequency is the running total of frequencies up to and including a class",
          "Cumulative frequency points are plotted at the upper class boundary",
          "Median $approx$ the $n/2$th value; $Q_1 approx$ the $n/4$th value; $Q_3 approx$ the $3n/4$th value, read from the curve"
        ]
      },
      "questions": [
        {
          "prompt": "A badminton club surveyed the ages of its 70 members, giving the frequency table: 20–30 (3), 30–40 (10), 40–50 (18), 50–60 (24), 60–70 (12), 70–80 (3). Construct the cumulative frequency table.",
          "marks": 3,
          "tier": 1,
          "contentTag": "Topic 4.2 — Constructing cumulative frequency tables",
          "skillTag": "Data organisation",
          "answer": "Cumulative frequencies at upper boundaries 30,40,50,60,70,80: 3, 13, 31, 55, 67, 70."
        },
        {
          "prompt": "Using the cumulative frequency table from the previous question, estimate the median age, $Q_1$ and $Q_3$ of the club's members, using linear interpolation.",
          "marks": 4,
          "tier": 1,
          "contentTag": "Topic 4.2 — Reading quartiles from cumulative frequency graphs",
          "skillTag": "Graphical estimation",
          "answer": "Median (35th value) lies in class 50–60 (cf 31 to 55): $50 + (35-31)/(55-31) times 10 approx 51.7$. $Q_1$ (17.5th value) lies in class 40–50 (cf 13 to 31): $40 + (17.5-13)/(31-13) times 10 approx 42.5$. $Q_3$ (52.5th value) lies in class 50–60 (cf 31 to 55): $50+(52.5-31)/(55-31) times 10 approx 58.96$."
        },
        {
          "prompt": "Prove that the cumulative frequency function $F(x) = sum_(x_i <= x) f_i$ is a non-decreasing function of $x$, for any frequency distribution in which every frequency $f_i >= 0$.",
          "marks": 5,
          "tier": 3,
          "contentTag": "Topic 4.2 — Monotonicity of cumulative frequency (proof)",
          "skillTag": "Proof by direct argument from definition",
          "hint": "Let $x_2 > x_1$ and consider $F(x_2) - F(x_1)$; express this difference as a sum of frequencies for classes strictly between $x_1$ and $x_2$.",
          "answer": "Let $x_2 > x_1$. By definition, $F(x_2) = sum_(x_i <= x_2) f_i$ and $F(x_1) = sum_(x_i <= x_1) f_i$. Every class counted in $F(x_1)$ is also counted in $F(x_2)$ (since $x_i <= x_1 < x_2$ implies $x_i <= x_2$), so $F(x_2) - F(x_1) = sum_(x_1 < x_i <= x_2) f_i$, a sum of frequencies, each of which satisfies $f_i >= 0$. Hence $F(x_2) - F(x_1) >= 0$, i.e. $F(x_2) >= F(x_1)$ whenever $x_2 > x_1$, proving $F$ is non-decreasing. $qed$"
        },
        {
          "prompt": "Using the badminton club's cumulative frequency curve, determine the 90th percentile of the members' ages and interpret its meaning in context.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.2 — Percentiles and their interpretation",
          "skillTag": "Contextual interpretation of statistical measures",
          "answer": "90th percentile corresponds to the $0.9 times 70 = 63$rd value, which lies in the class 60–70 (cf 55 to 67): $60 + (63-55)/(67-55) times 10 approx 66.7$. This means approximately 90% of the club's members are aged 66.7 or younger, so any member older than about 66.7 is in the oldest 10% of the club."
        },
        {
          "prompt": "A mining company collects 40 samples and records the percentage copper ore content, giving a cumulative frequency curve passing approximately through $(0,0)$, $(28,10)$, $(44,20)$, $(80,30)$ and $(96,40)$. For the mine to be profitable, at least 75% of samples must contain more than 20% copper ore.",
          "marks": 6,
          "tier": 3,
          "contentTag": "Topic 4.2 — Application: percentile-based decision making",
          "skillTag": "Evidence-based recommendation from graphical data",
          "hint": "First read the cumulative frequency at $x=20$ (interpolating between the given points), then convert this into a percentage of samples with ore content at most 20%, and hence find the percentage exceeding 20%.",
          "answer": "Interpolating between $(0,0)$ and $(28,10)$: cumulative frequency at $x=20$ is $20/28 times 10 approx 7.1$, so about 7 of 40 samples ($approx 17.5%$) contain 20% or less copper ore, meaning about $100% - 17.5% approx 82.5%$ exceed 20% (closest tabulated estimate: 80%). Since $80% > 75%$, the profitability threshold is met, so the company should proceed with the mine, while noting the estimate carries some uncertainty from graphical reading."
        }
      ],
      "geometricReading": {
        "body": "The steepness of the cumulative frequency curve at any point directly mirrors the height of the corresponding histogram bar: a steep section of the S-shaped curve corresponds to the modal class, where frequency accumulates quickly, while a nearly flat section corresponds to a class with very low frequency. This is the same relationship, in embryonic form, that calculus later formalises as the derivative of an accumulation function — the cumulative frequency curve is, informally, an integral of the frequency distribution."
      }
    },
    {
      "heading": "Part 5 — Synthesis, Application and Reflection",
      "prerequisiteBox": {
        "items": [
          "All sampling method definitions and stratified allocation calculations (Part 1)",
          "Constructing grouped frequency tables and estimating the mean (Part 2)",
          "Constructing and interpreting box-and-whisker plots, including outliers and skew (Part 3)",
          "Constructing cumulative frequency curves and reading percentiles (Part 4)"
        ]
      },
      "questions": [
        {
          "prompt": "Your school wants to know whether there is a difference in average daily screen time between Year 12 and Year 13 students. Design and carry out a full statistical investigation.",
          "marks": 10,
          "tier": 3,
          "contentTag": "Topic 4.1/4.2 — Full statistical investigation",
          "skillTag": "Extended investigation: synthesis of sampling and presentation",
          "hint": "Keep your two sample sizes reasonably large (at least 15 per group) and equal in method, so that any difference you observe is more likely to reflect a real difference between year groups rather than sampling method.",
          "answer": "A strong response will: (a) justify a stratified sample by year group and possibly gender, with a clearly calculated allocation; (b) present a grouped frequency table with sensible, equal class widths and an estimated mean for each group; (c) construct comparative box-and-whisker plots, correctly identifying any outliers using the $1.5 times ZQBACKSLASHZQ"IQRZQBACKSLASHZQ"$ rule and commenting on relative skew and spread; (d) construct or reference a cumulative frequency curve for at least one group to estimate the IQR and cross-check the box-plot quartiles; and (e) draw a conclusion that explicitly acknowledges the limitations of sample size and self-reported data.",
          "subparts": [
            { "prompt": "Suggest an appropriate stratified sampling design, specifying exact sample sizes for each stratum.", "marks": 2, "tier": 2, "contentTag": "Topic 4.1 — Stratified sampling design", "skillTag": "Applying proportional allocation to a new context" },
            { "prompt": "Using either real or provided data, construct a grouped frequency table for each year group and estimate each group's mean screen time.", "marks": 2, "tier": 2, "contentTag": "Topic 4.2 — Grouping and estimating the mean", "skillTag": "Data organisation and calculation" },
            { "prompt": "Construct comparative box-and-whisker plots for the two groups and comment on differences in spread and skew.", "marks": 3, "tier": 3, "contentTag": "Topic 4.2 — Comparative box-and-whisker plots", "skillTag": "Interpretation and comparison of spread" },
            { "prompt": "Construct a cumulative frequency curve for one group, estimate its IQR, and state whether any outliers exist.", "marks": 3, "tier": 3, "contentTag": "Topic 4.2 — Cumulative frequency curves and outliers", "skillTag": "Cross-checking representations for consistency" }
          ]
        },
        {
          "prompt": "A health organisation reports: 'Sample surveys show that 62% of adults exercise regularly.' Comment on two features of the sampling methodology you would want to know before accepting this statistic as a valid representation of the population.",
          "marks": 4,
          "tier": 2,
          "contentTag": "Topic 4.1 — Critical evaluation of statistical claims",
          "skillTag": "Critical thinking about statistical validity",
          "answer": "Two reasonable features to demand: (1) the sampling method used (was it random/stratified, or convenience — e.g. an online opt-in survey that over-represents certain groups?) and (2) the sample size and response rate (a small sample or low response rate increases the chance the 62% figure does not reflect the true population proportion, and non-response itself can introduce bias if those who exercise are more likely to respond)."
        },
        {
          "prompt": "Evaluate the claim that stratified sampling always produces a less biased estimate of a population parameter than simple random sampling, considering at least one realistic scenario in which the claim may not hold.",
          "marks": 4,
          "tier": 3,
          "contentTag": "Topic 4.1 — Evaluating the limits of a sampling method",
          "skillTag": "Evaluation of a general methodological claim",
          "hint": "Consider what happens if the strata themselves are defined using an incorrect or outdated characteristic, or if the population proportions used to allocate the strata are wrong.",
          "answer": "Stratified sampling reduces bias only when the chosen strata are genuinely relevant to the variable being measured and the population proportions used for allocation are accurate. If the strata are defined using an irrelevant characteristic (e.g. stratifying by house colour when investigating exam performance), stratification offers no advantage over simple random sampling. Similarly, if the population proportions used to allocate sample sizes are outdated or estimated incorrectly (e.g. from an old census), the resulting sample can be systematically skewed despite appearing methodologically rigorous. Hence stratified sampling is not unconditionally less biased — its benefit depends entirely on the appropriateness and accuracy of the stratification variable chosen."
        }
      ]
    }
  ]
}$draftpayload$, 'ZQBACKSLASHZQ', chr(92))::jsonb
where id = '2909b0e8-4228-4e8a-95cb-77ae9891c288';;
