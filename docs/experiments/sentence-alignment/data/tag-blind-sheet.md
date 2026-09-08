# 盲评：Google 插句边界标签 vs 不插

判据：**作为这段英文的中译，哪一版更好**。看术语准确、语序自然、有无漏译错译；
占位符统一显示成 ⟦n⟧，不作为判据。答「甲」「乙」或「平」。


## 1

**原文** We spell out the paradigm of exact conditioning as an intuitive and powerful way of conditioning on observations in probabilistic programs. This is contrasted with likelihood-based scoring known from languages such as Stan. We study exact conditioning in the cases of discrete and Gaussian probability, presenting prototypical languages for each case and giving semantics to them. We make use of categorical probability (namely Markov and CD categories) to give a general account of exact conditioning which avoids limits and measure theory, instead focusing on restructuring dataflow and program equations. The correspondence between such categories and a class of programming languages is made precise by defining the internal language of a CD category.

**甲** 我们将精确条件范式阐述为概率程序中基于观测结果进行条件化的直观而强大的方法。这与 Stan 等语言中已知的基于似然性的评分方式形成对比。我们研究离散概率和高斯概率情况下的精确条件，为每种情况提出原型语言并赋予其语义。我们利用范畴概率（即马尔可夫范畴和 CD 范畴）来对精确条件进行一般性描述，从而避免极限和测度论，而是专注于重构数据流和程序方程。通过定义 CD 类别的内部语言，可以精确地确定此类类别与一类编程语言之间的对应关系。

**乙** 我们阐述了精确条件范式，将其作为一种直观而强大的概率程序观测条件化方法。这与Stan等语言中常见的基于似然的评分方法形成对比。我们研究了离散概率和高斯概率下的精确条件，并为每种情况提出了原型语言，赋予它们语义。我们利用范畴概率（即马尔可夫范畴和CD范畴）对精确条件进行了一般性描述，避免了极限和测度论，而是专注于重构数据流和程序方程。通过定义CD范畴的内部语言，我们精确地建立了此类范畴与一类编程语言之间的对应关系。


## 2

**原文** The proofs are straightforward if tedious string diagram manipulations. We showcase the validation of one interesting equation, (⟦2⟧), here and move the remaining derivations to the appendix (⟦3⟧). Let ⟦4⟧, ⟦5⟧ and ⟦6⟧. Then showing

**甲** 证明过程虽然繁琐，但主要依靠弦图操作，并不复杂。我们展示了一个有趣的方程的验证，（⟦2⟧ ），并将剩余的推导移至附录（⟦3⟧ ）。 让⟦4⟧，⟦5⟧和⟦6⟧然后显示

**乙** 证明过程虽然繁琐，但过程本身并不复杂，需要进行大量的字符串图运算。我们展示了一个有趣的方程的验证，（⟦2⟧ ），并将剩余的推导移至附录（⟦3⟧ ）。让⟦4⟧，⟦5⟧和⟦6⟧。然后显示


## 3

**原文** In ⟦1⟧ we introduced the ⟦2⟧ construction (⟦3⟧) as a way of building a category that accommodates the abstract inference for Markov categories (⟦4⟧). As we have seen, we can interpret the CD calculus (⟦5⟧) in categories built from the ⟦6⟧ construction, and this forms a probabilistic programming language with exact conditioning. In this final section, we will work out in detail what the ⟦7⟧ construction does when applied to our specific example settings of finite and Gaussian probability.

**甲** 在⟦1⟧我们引入了⟦2⟧建造 （⟦3⟧ ）作为一种构建能够容纳马尔可夫范畴抽象推理的范畴的方法（⟦4⟧ ）。正如我们所看到的，我们可以解释 CD 演算（⟦5⟧ ）在由以下因素构成的类别中⟦6⟧构造，从而形成一种具有精确条件的概率编程语言。在最后一部分，我们将详细阐述……⟦7⟧当应用于我们特定示例设置（有限概率和高斯概率）时，构造确实有效。

**乙** 在⟦1⟧我们引入了⟦2⟧建造 （⟦3⟧ ）作为一种构建能够容纳马尔可夫范畴抽象推理的范畴的方法（⟦4⟧正如我们所看到的，我们可以解释 CD 演算（⟦5⟧ ）在由以下因素构成的类别中⟦6⟧构造过程，由此形成了一种具有精确条件数的概率编程语言。在最后一节中，我们将详细阐述……⟦7⟧当应用于我们特定示例设置（有限概率和高斯概率）时，构造确实有效。


## 4

**原文** A probability measure is a measure satisfying ⟦2⟧. If ⟦3⟧ is a measure on ⟦4⟧ and ⟦5⟧ is measurable, the pushforward measure ⟦7⟧ is defined by ⟦8⟧. For ⟦9⟧, the Dirac measure ⟦11⟧ is the probability measure on ⟦12⟧ defined, using Iverson backet notation, by ⟦13⟧. The Borel-Lebesgue measure is the unique measure on ⟦14⟧ assigning every interval its length, that is ⟦15⟧ for all ⟦16⟧. For two probability measures ⟦17⟧, the product probability measure ⟦18⟧ is uniquely defined via ⟦19⟧ for all measurable ⟦20⟧. A subset which is assigned measure zero can be seen as negligible; this informs the following terminology:

**甲** 概率测度是满足以下条件的测度：⟦2⟧ 。 如果⟦3⟧是一项衡量⟦4⟧和⟦5⟧是可衡量的，推进措施⟦7⟧由……定义⟦8⟧。 为了⟦9⟧狄拉克测度⟦11⟧是概率测度⟦12⟧使用艾弗森·贝克特符号定义，⟦13⟧ Borel-Lebesgue 测度是唯一的测度。⟦14⟧给每个区间赋予其长度，即⟦15⟧对所有⟦16⟧对于两个概率测度⟦17⟧乘积概率测度⟦18⟧通过以下方式唯一确定⟦19⟧对于所有可测量的⟦20⟧测度为零的子集可以被视为可以忽略不计；这解释了以下术语：

**乙** 概率测度是满足以下条件的测度：⟦2⟧ 。如果⟦3⟧是一项衡量⟦4⟧和⟦5⟧是可衡量的，推进措施⟦7⟧由……定义⟦8⟧。为了⟦9⟧狄拉克测度⟦11⟧是概率测度⟦12⟧使用艾弗森·贝克特符号定义，⟦13⟧ 。 Borel-Lebesgue 测度是唯一的测度⟦14⟧给每个区间赋予其长度，即⟦15⟧对所有⟦16⟧。对于两个概率测度⟦17⟧乘积概率测度⟦18⟧通过以下方式唯一确定⟦19⟧对于所有可测量的⟦20⟧。度量值为零的子集可以视为可忽略不计；由此引申出以下术语：


## 5

**原文** Syntax-guided Synthesis. Our main idea for learning invariant expressions is drawn from syntax-guided synthesis ⟦2⟧. We assume that we are given a grammar ⟦3⟧ that defines Boolean-valued formulas over parametric atomic predicates: ⟦5⟧ Here, ⟦6⟧ expressions are user-supplied, Boolean-valued expressions over the program variables and parameters that we call parametric atomic predicates. Parameters ⟦7⟧ in ⟦8⟧ are placeholders for constant values of corresponding types. Replacing all parameters with appropriate constants gives a predicate symbol over the program variables.

**甲** 语法引导合成。我们学习不变表达式的主要思想来源于语法引导合成。⟦2⟧我们假设给定一个语法。⟦3⟧它定义了基于参数化原子谓词的布尔值公式：⟦5⟧这里，⟦6⟧表达式是用户提供的、布尔值的表达式，它们作用于程序变量和参数，我们称之为参数化原子谓词。参数⟦7⟧在⟦8⟧这些参数是对应类型常量值的占位符。将所有参数替换为适当的常量，即可得到程序变量上的谓词符号。

**乙** 句法引导合成。我们学习不变表达式的主要思路来源于语法引导综合。⟦2⟧ 。我们假设我们已知一个语法。⟦3⟧它定义了基于参数化原子谓词的布尔值公式：⟦5⟧这里，⟦6⟧表达式是用户提供的、对程序变量和参数（我们称之为参数化原子谓词）取布尔值的表达式。参数⟦7⟧在⟦8⟧是对应类型常量值的占位符。将所有参数替换为适当的常量，即可得到程序变量上的谓词符号。


## 6

**原文** for every point ⟦1⟧. For two multisets of points ⟦2⟧ we write ⟦3⟧ for the multiset of points in ⟦4⟧ with multiplicity ⟦5⟧ for every point ⟦6⟧. Similarly, for each multiset ⟦7⟧ in ⟦8⟧ and each integer ⟦9⟧ we write ⟦10⟧ for the multiset of points in ⟦11⟧ with multiplicity ⟦12⟧ for every point ⟦13⟧.

**甲** 对于每个点⟦1⟧对于两个多重集点⟦2⟧我们写道⟦3⟧对于多重点集⟦4⟧多重性⟦5⟧对于每个点⟦6⟧类似地，对于每个多重集⟦7⟧在⟦8⟧以及每个整数⟦9⟧我们写道⟦10⟧对于多重点集⟦11⟧多重性⟦12⟧对于每个点⟦13⟧。

**乙** 对于每个点⟦1⟧。对于两组多重点集⟦2⟧我们写道⟦3⟧对于多重点集⟦4⟧多重性⟦5⟧对于每个点⟦6⟧。类似地，对于每个多重集⟦7⟧在⟦8⟧以及每个整数⟦9⟧我们写道⟦10⟧对于多重点集⟦11⟧多重性⟦12⟧对于每个点⟦13⟧。


## 7

**原文** ⟦1⟧ ⟦2⟧ Uniqueness was e.g. computationally verified in ⟦3⟧. For a purely theoretic argument see “The uniqueness of the binary linear ⟦4⟧ code” by A. E. Brouwer from April 1992, available at https://www.win.tue.nl/⟦5⟧aeb/preprints.html.

**甲** ⟦1⟧⟦2⟧例如，唯一性已通过计算方法验证。⟦3⟧纯理论论证请参见“二元线性方程组的唯一性”。⟦4⟧ AE Brouwer 于 1992 年 4 月发布的代码”，可在 https://www.win.tue.nl/ 获取。⟦5⟧ aeb/preprints.html。

**乙** ⟦1⟧⟦2⟧例如，唯一性已通过计算方法验证。⟦3⟧ 。关于纯理论论证，请参见“二元线性方程组的唯一性”。⟦4⟧ AE Brouwer 于 1992 年 4 月发布的代码”，可在 https://www.win.tue.nl/ 获取。⟦5⟧ aeb/preprints.html。


## 8

**原文** Rapidity-dependent measurements provide a clearer illustration of this issue. In a recent study by Ref. ⟦1⟧, the implementation of NEOS-BQS was observed to disrupt the agreement between theoretical predictions and experimental measurements, particularly in the directed flows in rapidity, ⟦2⟧, for identified hadrons with strangeness (e.g., ⟦3⟧ and ⟦4⟧ carrying opposite ⟦5⟧). According to the experimental measurements at 7.7 GeV, the slope of ⟦6⟧ around midrapidity showed opposite signs for ⟦7⟧ and ⟦8⟧. The enforced strangeness neutrality within NEOS-BQS tends to couple their ⟦9⟧, leading to a similar rapidity dependence, contradicting the observed measurements. This study underscores the necessity of hydrodynamically evolving multiple charges by employing the complete four-dimensional EoS, ⟦10⟧, when investigating some particular rapidity-dependent observables.

**甲** 依赖于速度的测量可以更清晰地说明这个问题。在最近的一项研究中，参考文献……⟦1⟧研究发现，NEOS-BQS 的实施破坏了理论预测与实验测量之间的一致性，尤其是在快速定向流动方面。⟦2⟧对于已识别的具有奇异性的强子（例如，⟦3⟧和⟦4⟧相反的⟦5⟧根据7.7 GeV处的实验测量结果，斜率为⟦6⟧中速附近显示出相反的符号⟦7⟧和⟦8⟧NEOS-BQS内部强制推行的怪异中立性往往会将它们联系起来。⟦9⟧这导致了类似的快度依赖性，与观测到的测量结果相矛盾。这项研究强调了通过采用完整的四维状态方程对多个电荷进行流体动力学演化的必要性。⟦10⟧在研究某些特定的与快度相关的可观测物理量时。

**乙** 速度相关的测量可以更清楚地说明这个问题。在最近的一项研究中，参考文献⟦1⟧研究发现，NEOS-BQS 的实施破坏了理论预测与实验测量之间的一致性，尤其是在快速定向流动方面。⟦2⟧对于已识别的具有奇异性的强子（例如，⟦3⟧和⟦4⟧相反的⟦5⟧）。根据7.7 GeV处的实验测量结果，斜率⟦6⟧中速附近显示出相反的符号⟦7⟧和⟦8⟧。 NEOS-BQS内部强制推行的怪异中立性往往会将它们联系起来⟦9⟧导致类似的快度依赖性，与观测到的测量结果相矛盾。这项研究强调了利用完整的四维状态方程对多个电荷进行流体动力学演化的必要性，⟦10⟧在研究某些特定的与快度相关的可观测物理量时。


## 9

**原文** FiQA-SA⟦2⟧: This dataset is based on the task 1 of the Financial Sentiment Analysis in the Wild (FiQA) challenge. The dataset is split into three subsets: train, valid, test with sizes 822, 117, 234 respectively. We used the test split in our experiments.

**甲** FiQA-SA⟦2⟧该数据集基于“金融情绪分析实战”（FiQA）挑战赛的任务 1。数据集分为三个子集：训练集、验证集、测试集，大小分别为 822、117、234。我们在实验中使用了测试集拆分。

**乙** FiQA-SA⟦2⟧本数据集基于FiQA（Financial Sentiment Analysis in the Wild）挑战赛的任务1。数据集分为三个子集：训练集、验证集和测试集，大小分别为822、117和234。我们的实验使用了测试集。


## 10

**原文** To investigate the origin of our targets, we computed their mean orbital trajectories over the past 1 Gyr, based on 1000 Monte Carlo realizations with a time step of 1 Myr, adopting the ⟦1⟧ Galactic potential. We first verify whether any of our HVS candidates may originate via the Hills mechanism ⟦2⟧, assuming that this will be the case of objects whose minimum Galactocentric distance along its orbit is ⟦3⟧ kpc. This is similar to the criteria used in previous works ⟦4⟧. In our sample, none of them satisfy this condition with the exception of HVS07, which has a past orbit that approximates to the inner MW at ⟦5⟧ kpc from its center, almost 11 Myr ago, when ⟦6⟧ = 710 ⟦7⟧ 70 km s-1. This velocity lies near the lower limit of the range of ejection velocities predicted for intermediate mass stars produced via the Hills mechanism in the vicinity of the Galactic SMBH ⟦10⟧. While such low velocities are not excluded - particularly for intermediate/low-mass stars, which can remain bound - this nonetheless casts doubt on a Galactic Center origin for this HVS candidate.

**甲** 为了探究目标天体的起源，我们基于1000次蒙特卡罗模拟（时间步长为1百万年），计算了它们过去10亿年的平均轨道轨迹。⟦1⟧银河系潜力。我们首先验证我们的高亮度超新星候选者中是否有任何可能起源于希尔斯机制。⟦2⟧假设这种情况适用于沿其轨道方向的最小银心距离为⟦3⟧kpc。这与先前研究中使用的标准类似。⟦4⟧在我们的样本中，除了HVS07之外，没有其他天体满足这个条件，HVS07的过去轨道近似于银河系内表面。⟦5⟧距其中心约1100万年前，⟦6⟧ = 710⟦7⟧ 70 km s⁻¹。这个速度接近于银河系超大质量黑洞附近通过希尔斯机制产生的中等质量恒星的抛射速度预测范围的下限。⟦10⟧虽然不能排除这种低速度的可能性——特别是对于中等/低质量恒星而言，它们可以保持束缚状态——但这仍然使人们对这颗高速恒星候选者的银河系中心起源产生怀疑。

**乙** 为了探究目标天体的起源，我们基于1000次蒙特卡罗模拟（时间步长为1百万年），计算了它们过去10亿年的平均轨道轨迹。⟦1⟧银河系潜力。我们首先验证我们的高视觉敏感度候选者中是否有任何可能源自希尔机制。⟦2⟧假设这种情况适用于沿其轨道方向的最小银心距离为⟦3⟧kpc。这与以往研究中使用的标准类似。⟦4⟧ 。在我们的样本中，除了HVS07之外，没有其他天体满足这个条件，HVS07的过去轨道近似于银河系内轨道。⟦5⟧距其中心约1100万年前，⟦6⟧ = 710⟦7⟧ 70 公里/秒。该速度接近于根据希尔斯机制在银河系超大质量黑洞附近产生的中等质量恒星的喷射速度预测范围的下限。⟦10⟧ 。虽然不能排除这种低速度的可能性——特别是对于中等/低质量恒星而言，它们可以保持束缚状态——但这仍然使人们对这颗高速恒星候选者起源于银河系中心的推测产生了怀疑。


## 11

**原文** In Figure ⟦1⟧, the challenging features (decorators and function pointers) obstruct intra-language analysis, hence breaking the flow across the language boundary. These features often cause implicit information flow, which may bear stealthy vulnerabilities. To understand this problem, we intend to systematically identify such language features that challenge static analysis. We took a three-pronged study methodology: (1) analysis of prominent open-source Python-C and Java-C projects on GitHub (including those in cross-language bug datasets ⟦2⟧), (2) review of developer discussions and official language documentation, and (3) empirical evaluation of popular static analysis tools. Via manual inspection, we track cross-language information flows to pinpoint critical locations and root causes of cross-language bugs in relation to specific Python, Java and C features that frequently hinder the static analyzers (e.g., by breaking control/data flow tracking).

**甲** 如图⟦1⟧这些具有挑战性的特性（装饰器和函数指针）会阻碍语言内部的分析，从而破坏跨语言边界的信息流。这些特性通常会导致隐式信息流，其中可能隐藏着一些安全漏洞。为了理解这个问题，我们计划系统地识别这些对静态分析构成挑战的语言特性。我们采用了一种三管齐下的研究方法：（1）分析GitHub上一些知名的开源Python-C和Java-C项目（包括跨语言缺陷数据集中的项目）⟦2⟧ （2）查阅开发者讨论和官方语言文档，以及（3）对常用静态分析工具进行实证评估。通过人工检查，我们追踪跨语言信息流，以精确定位与特定 Python、Java 和 C 特性相关的跨语言 bug 的关键位置和根本原因，这些特性经常会阻碍静态分析器的工作（例如，破坏控制/数据流追踪）。

**乙** 如图⟦1⟧这些具有挑战性的特性（装饰器和函数指针）阻碍了语言内部的分析，从而破坏了跨语言边界的流程。这些特性往往会导致隐性信息流动，从而可能存在隐蔽的漏洞。为了理解这个问题，我们打算系统地识别出那些对静态分析构成挑战的语言特征。我们采用了三管齐下的研究方法：（1）分析GitHub上著名的开源Python-C和Java-C项目（包括跨语言错误数据集中的项目）⟦2⟧ ），（2）审查开发者讨论和官方语言文档，以及（3）对流行的静态分析工具进行实证评估。我们通过人工检查来跟踪跨语言信息流，以精确定位与特定 Python、Java 和 C 特性相关的跨语言错误的关键位置和根本原因，这些特性经常阻碍静态分析器（例如，破坏控制/数据流跟踪）。


## 12

**原文** In both Python-C and Java-C subjects, we observe that “hard” language feature usages are routine rather than exceptional. Python-C projects frequently rely on first-class functions and non-trivial native control variability (e.g., conditional compilation and low-level control-flow constructs), while Java-C projects consistently embed native interaction inside object-oriented APIs and commonly introduce additional indirection via reflection and lambda-based callbacks. On the native side, Java-C subjects exhibit denser preprocessor- and indirection-heavy patterns (e.g., function pointers and macros), further complicating static cross-language analysis.

**甲** 在 Python-C 和 Java-C 课程中，我们发现“难”的语言特性使用是常规的，而不是例外情况。 Python-C 项目经常依赖于一等函数和非平凡的本地控制可变性（例如，条件编译和底层控制流结构），而 Java-C 项目则始终将本地交互嵌入到面向对象的 API 中，并且通常通过反射和基于 lambda 的回调引入额外的间接性。在原生语言方面，Java-C 主题表现出更密集的预处理器和间接寻址模式（例如，函数指针和宏），这进一步增加了静态跨语言分析的复杂性。

**乙** 在 Python-C 和 Java-C 案例中，我们观察到“硬性”语言特性的使用是常规的而非例外。Python-C 项目经常依赖于一等函数和非平凡的本地控制可变性（例如，条件编译和底层控制流结构），而 Java-C 项目则始终将本地交互嵌入到面向对象的 API 中，并且通常通过反射和基于 lambda 的回调引入额外的间接层。在本地方面，Java-C 案例表现出更密集的预处理器和间接层密集模式（例如，函数指针和宏），这进一步增加了静态跨语言分析的复杂性。


## 13

**原文** ⟦1⟧ ⟦2⟧ A density induces a measure on ⟦3⟧. That it is a smooth, strictly positive density means that this measure is given by integration against a smooth, positive function in any coordinate system.

**甲** ⟦1⟧⟦2⟧密度诱导出一个度量⟦3⟧. 它是一个光滑的、严格正的密度函数，这意味着该测度可以通过对任何坐标系中的光滑正函数进行积分来给出。

**乙** ⟦1⟧⟦2⟧密度诱导出一个度量⟦3⟧。它是一个光滑的、严格正的密度函数，这意味着该度量可以通过对任何坐标系中的光滑正函数进行积分来给出。


## 14

**原文** In this section, we present the main technical result of this paper. The statement is somewhat involved because our goal is to formulate the result using only the assumptions needed for the proof. For more accessible corollaries, we refer the reader to Corollary ⟦1⟧ and Section ⟦2⟧.

**甲** 本节将介绍本文的主要技术成果。这个陈述有些复杂，因为我们的目标是仅使用证明所需的假设来得出结果。如需更易于理解的推论，请参阅推论。⟦1⟧和章节⟦2⟧。

**乙** 本节介绍本文的主要技术结果。由于我们的目标是仅使用证明所需的假设来表述结果，因此表述较为复杂。如需更易于理解的推论，请参阅推论。⟦1⟧和章节⟦2⟧。


## 15

**原文** In light of Lemma ⟦1⟧, the statement of Proposition ⟦2⟧ is unchanged if ⟦3⟧ and ⟦4⟧ are replaced throughout by ⟦5⟧ and ⟦6⟧. Moreover, in the proof which follows, we only consider ⟦7⟧ for ⟦8⟧ and ⟦9⟧ and we only consider ⟦10⟧ for ⟦11⟧. Thus, we may verify the assumptions of ⟦12⟧ using ⟦13⟧ even though it is not a globally defined metric, because it agrees with the globally defined metric ⟦14⟧ from Lemma ⟦15⟧ wherever we use it. Moreover, by Lemma ⟦16⟧⟦17⟧, the topology generated by ⟦18⟧ agrees with the usual topology on ⟦19⟧, so we do not need to make the distinction about which topology we are using in the sequel.

**甲** 根据引理⟦1⟧命题的陈述⟦2⟧如果保持不变⟦3⟧和⟦4⟧全文均被替换为⟦5⟧和⟦6⟧。此外，在接下来的证明中，我们只考虑⟦7⟧为了⟦8⟧和⟦9⟧我们只考虑⟦10⟧为了⟦11⟧。因此，我们可以验证以下假设：⟦12⟧使用⟦13⟧即使它不是全球通用的指标，因为它与全球通用的指标相一致。⟦14⟧引理⟦15⟧无论我们在哪里使用它。此外，根据引理⟦16⟧⟦17⟧由……生成的拓扑结构⟦18⟧与通常的拓扑结构一致⟦19⟧因此，我们不需要区分在后续内容中使用哪种拓扑结构。

**乙** 根据引理⟦1⟧命题的陈述⟦2⟧如果保持不变⟦3⟧和⟦4⟧全文均被替换为⟦5⟧和⟦6⟧此外，在接下来的证明中，我们只考虑⟦7⟧为了⟦8⟧和⟦9⟧我们只考虑⟦10⟧为了⟦11⟧因此，我们可以验证以下假设：⟦12⟧使用⟦13⟧即使它不是全球通用的指标，因为它与全球通用的指标相一致。⟦14⟧引理⟦15⟧无论我们何时使用它。此外，根据引理⟦16⟧⟦17⟧由……生成的拓扑结构⟦18⟧与通常的拓扑结构一致⟦19⟧因此，我们不需要区分在后续内容中使用哪种拓扑结构。


## 16

**原文** Sometimes a thread locks a mutex before creating child threads and does not release it until certain protected operations have completed. This pattern requires intricate handling beyond existing per-thread lockset analyses. Partially inspired by ⟦1⟧, we propose a way of handling such patterns with digests in ⟦2⟧. Another pattern, where locks are held by a thread during the entire execution of its child is covered in ⟦3⟧. We implemented the proposed digests in an abstract interpreter. The experiments we conducted on a set of hand-crafted examples using these constructs are discussed in ⟦4⟧.

**甲** 有时，一个线程会在创建子线程之前锁定互斥锁，并且直到某些受保护的操作完成后才会释放它。这种模式需要比现有的逐线程锁集分析更复杂的处理方法。部分灵感来源于⟦1⟧我们提出了一种利用摘要处理此类模式的方法。⟦2⟧ 。另一种模式，即锁在其子程序执行的整个过程中都由一根线保持连接，这种模式被覆盖在⟦3⟧。我们在抽象解释器中实现了所提出的摘要。我们在一组使用这些结构精心制作的示例上进行的实验将在下文中讨论。⟦4⟧ 。

**乙** 有时，线程会在创建子线程之前锁定互斥锁，并且直到某些受保护的操作完成后才会释放它。这种模式需要比现有线程级锁集分析更复杂的处理方式。部分灵感来源于⟦1⟧我们提出了一种利用摘要处理此类模式的方法。⟦2⟧另一种模式，即锁在其子进程执行的整个过程中都由线程保持，这种情况已在……中有所描述。⟦3⟧我们在抽象解释器中实现了所提出的摘要。我们在使用这些构造对一组手工编写的示例进行的实验将在文中讨论。⟦4⟧ 。


## 17

**原文** At the second access, we record which threads have locked each mutex. We can exclude a race if a lock of ⟦1⟧ has happened at some point after the creation in ⟦2⟧ in the created thread or—for the same reason as above—one of its descendants. If ⟦3⟧ was locked in ⟦4⟧, this is the case if ⟦5⟧ must be an ancestor of ⟦6⟧. We describe a suitable digest in ⟦7⟧.

**甲** 在第二次访问时，我们记录哪些线程锁定了每个互斥锁。如果某个线程锁定了互斥锁，我们可以排除竞争条件。⟦1⟧这件事发生在创造之后的某个时间点⟦2⟧在已创建的主题中，或者——出于与上述相同的原因——在其某个子主题中。如果⟦3⟧被锁住了⟦4⟧如果情况如此，那就是这种情况。⟦5⟧必须是……的祖先⟦6⟧我们描述了一种合适的消化方法。⟦7⟧ 。

**乙** 在第二次访问时，我们记录哪些线程锁定了每个互斥锁。如果锁定成功，我们可以排除竞争条件。⟦1⟧这件事发生在创造之后的某个时间点⟦2⟧在创建的帖子中，或者——出于与上述相同的原因——在其后代帖子中。如果⟦3⟧被锁住了⟦4⟧如果情况如此，那就是这种情况。⟦5⟧必须是……的祖先⟦6⟧。我们描述了一种合适的消化方法⟦7⟧。


## 18

**原文** We next verify requirement ⟦1⟧. As before, if a concrete right-hand side returns None, the requirement follows immediately because None is the least element of ⟦4⟧. In the following cases, we may therefore assume that the concrete operation succeeds.

**甲** 接下来，我们验证要求。⟦1⟧与之前一样，如果具体的右侧项返回 None，则该要求立即成立，因为 None 是最小元素。⟦4⟧因此，在下列情况下，我们可以假设具体操作成功。

**乙** 接下来，我们验证要求。⟦1⟧ 。与之前一样，如果具体的右侧项返回 None，则该要求立即成立，因为 None 是最小元素。⟦4⟧ 。因此，在下列情况下，我们可以假设具体操作成功。


## 19

**原文** Let a differentiable scalar loss ⟦1⟧ depend on any output derivatives ⟦2⟧, including derivatives of coupled fields, and write the adjoint as ⟦3⟧. The backward sweep follows (⟦4⟧)–(⟦5⟧). Differentiating (⟦6⟧) gives

**甲** 设损失函数为可微标量损失。⟦1⟧取决于任何输出导数⟦2⟧包括耦合场的导数，并将伴随算子写成⟦3⟧后向扫描如下（⟦4⟧ )–(⟦5⟧区分（⟦6⟧ ）给出

**乙** 设损失函数为可微标量损失。⟦1⟧取决于任何输出导数⟦2⟧包括耦合场的导数，并将伴随算子写成⟦3⟧。后向扫描如下（⟦4⟧ )–(⟦5⟧ ）。区分（⟦6⟧ ）给出


## 20

**原文** Equation (⟦1⟧) is used only as a manufactured collocation test. The stated initial and boundary data do not define a well-posed seventh-order initial-boundary-value problem. Table ⟦2⟧ therefore compares optimization under the specified loss; it does not establish general convergence of a PDE solver.

**甲** 方程式（⟦1⟧ ) 仅用作人为设计的搭配测试。所给出的初始和边界数据并不能定义一个适定的七阶初边值问题。桌子⟦2⟧因此，它比较的是指定损失下的优化；它并不建立偏微分方程求解器的一般收敛性。

**乙** 方程式（⟦1⟧仅用作人为配置测试。所提供的初始条件和边界条件并未定义一个适定的七阶初边值问题。表⟦2⟧因此，它比较的是指定损失下的优化；它并不建立偏微分方程求解器的一般收敛性。


## 21

**原文** For the same basis ⟦1⟧, we proved in ⟦2⟧ many necessary conditions for STLC based on quartic brackets, i.e. brackets with ⟦3⟧. For example, we proved that, with ⟦4⟧ for ⟦5⟧, and ⟦6⟧, a necessary condition for ⟦7⟧-STLC is that

**甲** 基于相同原理⟦1⟧我们已经证明⟦2⟧基于四次括号（即括号）的STLC的许多必要条件⟦3⟧例如，我们证明了，当⟦4⟧为了⟦5⟧， 和⟦6⟧这是必要条件⟦7⟧-STLC 是

**乙** 基于相同原理⟦1⟧我们已经证明⟦2⟧基于四次括号（即括号）的STLC的许多必要条件⟦3⟧。例如，我们证明了，当⟦4⟧为了⟦5⟧， 和⟦6⟧这是必要条件⟦7⟧-STLC 是


## 22

**原文** and, since ⟦2⟧, the right-hand side is of the form (⟦3⟧). By uniqueness it is the ⟦4⟧-factorization of ⟦5⟧, with factors ⟦6⟧, together with ⟦7⟧ if ⟦8⟧, and seed ⟦9⟧. As ⟦10⟧ is good, the induction hypothesis makes the first condition in (⟦11⟧) read “all ⟦12⟧ are good” for both alphabets. For the second condition:

**甲** 而且，由于⟦2⟧右侧的形式为（⟦3⟧ ）。它的独特之处在于⟦4⟧-因子分解⟦5⟧以及相关因素⟦6⟧与⟦7⟧如果⟦8⟧和种子⟦9⟧。作为⟦10⟧很好，归纳假设使第一个条件成立（⟦11⟧阅读“全部⟦12⟧这两个字母都适用。对于第二个条件：

**乙** 而且，由于⟦2⟧右侧的形式为（⟦3⟧ ）其独特性在于⟦4⟧-因子分解⟦5⟧以及相关因素⟦6⟧与⟦7⟧如果⟦8⟧和种子⟦9⟧。 作为⟦10⟧很好，归纳假设使第一个条件成立（⟦11⟧阅读“全部⟦12⟧对于两种字母来说都适用。第二个条件是：
