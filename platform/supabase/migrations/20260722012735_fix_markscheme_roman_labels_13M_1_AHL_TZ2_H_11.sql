UPDATE question_parts qp
SET markscheme_latex = $ms$(a)

(i)

$\overrightarrow{AB} = \overrightarrow{OB} - \overrightarrow{OA} = 5\boldsymbol{i} - \boldsymbol{j} - 2\boldsymbol{k}$ (or in column vector form)
\hfill (A1)

Note: Award A1 if any one of the vectors, or its negative, representing the sides of the triangle is seen.

$$
\begin{aligned}
|\overrightarrow{AB}| &= |5\boldsymbol{i} - \boldsymbol{j} - 2\boldsymbol{k}| = \sqrt{30} \\
|\overrightarrow{BC}| &= |-\boldsymbol{i} - 3\boldsymbol{j} + \boldsymbol{k}| = \sqrt{11} \\
|\overrightarrow{CA}| &= |-4\boldsymbol{i} + 4\boldsymbol{j} + \boldsymbol{k}| = \sqrt{33}
\end{aligned}
$$
\hfill A2

Note: Award A1 for two correct and A0 for one correct.

(ii)

METHOD 1

$$\cos \mathrm{BAC} = \frac{20 + 4 + 2}{\sqrt{30}\sqrt{33}}$$
\hfill M1A1

Note: Award M1 for an attempt at the use of the scalar product for two vectors representing the sides AB and AC, or their negatives, A1 for the correct computation using their vectors.

$$= \frac{26}{\sqrt{990}} \quad\left(= \frac{26}{3\sqrt{110}}\right)$$
\hfill A1

Note: Candidates who use the modulus need to justify it – the angle is not stated in the question to be acute.

METHOD 2

using the cosine rule

$$\cos \mathrm{BAC} = \frac{30 + 33 - 11}{2\sqrt{30}\sqrt{33}}$$
\hfill M1A1

$$= \frac{26}{\sqrt{990}} \left(= \frac{26}{3\sqrt{110}}\right)$$
\hfill A1

[6 marks]

(b)

(i)

$$\overrightarrow{BC} \times \overrightarrow{CA} = \begin{vmatrix} \boldsymbol{i} & \boldsymbol{j} & \boldsymbol{k} \\ -1 & -3 & 1 \\ -4 & 4 & 1 \end{vmatrix}$$
\hfill A1

$$= \big((-3) \times 1 - 1 \times 4\big)\boldsymbol{i} + \big(1 \times (-4) - (-1) \times 1\big)\boldsymbol{j} + \big((-1) \times 4 - (-3) \times (-4)\big)\boldsymbol{k}$$
\hfill M1A1

$$= -7\boldsymbol{i} - 3\boldsymbol{j} - 16\boldsymbol{k}$$
\hfill AG

(ii)

the area of $\Delta \mathrm{ABC} = \dfrac{1}{2}|\overrightarrow{BC} \times \overrightarrow{CA}|$
\hfill (M1)

$$\frac{1}{2}\sqrt{(-7)^2 + (-3)^2 + (-16)^2}$$
\hfill A1

$$= \frac{1}{2}\sqrt{314}$$
\hfill AG

[5 marks]

(c) attempt at the use of "$(\boldsymbol{r} - \boldsymbol{a}) \boldsymbol{\cdot} \boldsymbol{n} = 0$"
\hfill (M1)

using $\boldsymbol{r} = x\boldsymbol{i} + y\boldsymbol{j} + z\boldsymbol{k}$, $\boldsymbol{a} = \overrightarrow{OA}$ and $\boldsymbol{n} = -7\boldsymbol{i} - 3\boldsymbol{j} - 16\boldsymbol{k}$
\hfill (A1)

$$7x + 3y + 16z = 47$$
\hfill A1

Note: Candidates who adopt a 2-parameter approach should be awarded, A1 for correct 2-parameter equations for $x$, $y$ and $z$; M1 for a serious attempt at elimination of the parameters; A1 for the final Cartesian equation.

[3 marks]

(d) $\boldsymbol{r} = \overrightarrow{OA} + t\overrightarrow{AB}$ (or equivalent)
\hfill M1

$$\boldsymbol{r} = (-\boldsymbol{i} + 2\boldsymbol{j} + 3\boldsymbol{k}) + t(5\boldsymbol{i} - \boldsymbol{j} - 2\boldsymbol{k})$$
\hfill A1

Note: Award M1A0 if "$\boldsymbol{r} =$" is missing.

Note: Accept forms of the equation starting with B or with the direction reversed.

[2 marks]

(e)

(i)

$$\overrightarrow{OD} = (-\boldsymbol{i} + 2\boldsymbol{j} + 3\boldsymbol{k}) + t(5\boldsymbol{i} - \boldsymbol{j} - 2\boldsymbol{k})$$

statement that $\overrightarrow{OD} \boldsymbol{\cdot} \overrightarrow{BC} = 0$
\hfill (M1)

$$\begin{pmatrix} -1+5t \\ 2-t \\ 3-2t \end{pmatrix} \boldsymbol{\cdot} \begin{pmatrix} -1 \\ -3 \\ 1 \end{pmatrix} = 0$$
\hfill A1

$$-2 - 4t = 0 \text{ or } t = -\frac{1}{2}$$
\hfill A1

coordinates of $D$ are $\left(-\dfrac{7}{2}, \dfrac{5}{2}, 4\right)$
\hfill A1

Note: Different forms of $\overrightarrow{OD}$ give different values of $t$, but the same final answer.

(ii)

$t < 0 \implies D$ is not between A and B
\hfill R1

[5 marks]

Total [21 marks]$ms$
FROM ib_questions iq
WHERE qp.question_id = iq.id
  AND iq.code = '13M.1.AHL.TZ2.H_11';;
