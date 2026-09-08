## 1  [2312.17141 / body / 占位符 9]
EN: Otherwise [] , indicating that the inference problem has no solution. To be completely precise, since [] and [] are affine, the function [] is affine too, so we can find [] and [] such that [] and then we condition on [] using formula ( [] ).
A : 否则⟦1⟧这表明该推理问题无解。更准确地说，因为⟦2⟧和⟦3⟧是仿射函数⟦4⟧也是仿射的，所以我们可以找到⟦5⟧和⟦6⟧使得⟦7⟧然后我们根据⟦8⟧使用公式（⟦9⟧ ）。
B : 否则⟦b⟧，表示推理问题没有解。完全准确地说，由于 ⟦c⟧ 和 ⟦d⟧ 是仿射的，函数 ⟦e⟧ 也是仿射的，因此我们可以找到 ⟦f⟧ 和 ⟦g⟧，使得 ⟦h⟧，然后用公式 （⟦j⟧） 对 ⟦i⟧ 进行条件。

## 2  [2312.17141 / body / 占位符 2]
EN: There is nonetheless some normalization that can be done in straight-line programs, since e.g. the meaning is not changed by prefixing a program with a closed program. It is for example safe to regard program ( [] ) as equivalent to
A : 尽管如此，直线程序中仍然可以进行一些规范化，例如，在程序前加上闭式程序并不会改变其含义。例如，可以安全地将程序视为（⟦2⟧ ) 等同于
B : 不过，在直线程序中仍可进行一些规范化，因为例如，通过在程序前加上闭程序并不会改变其含义。例如，可以安全地将程序（⟦c⟧）视为等价于

## 3  [2312.17141 / body / 占位符 0]
EN: In stateful programming languages, composition of programs is often complicated and local transformations are difficult to reason about. This is what makes programs transformations like the ones we used powerful and nontrivial to verify.
A : 在有状态编程语言中，程序的组合通常很复杂，局部转换也难以理解。正因如此，我们使用的这类程序转换才显得强大而又难以验证。
B : 在有状态编程语言中，程序的组合通常很复杂，局部变换也难以推理。这正是我们用来验证的程序变换强大且非简单的原因。

## 4  [2312.17141 / body / 占位符 0]
EN: Rejection sampling makes sense for closed programs. For programs with free variables, we can still understand a program that rejects runs that violate the conditions, but normalization is more subtle. For example, in the program
A : 拒绝抽样对封闭程序来说是合理的。对于自由变量的程序，我们仍然可以理解程序会拒绝违反条件的运行，但归一化则更为微妙。例如，在程序中
B : 对于封闭程序，拒绝抽样是有意义的。对于包含自由变量的程序，我们仍然可以理解程序拒绝违反条件的运行，但归一化过程则更为微妙。例如，在程序中

## 5  [2312.17527 / body / 占位符 2]
EN: We assume that each of the sequential processes involved in the computation is deterministic, and the only source of nondeterminism is context switches due to an external scheduler [] . We also remark that an LTS is finite if the type of each program variable is finite, otherwise an LTS can have an infinite set of states.
A : 我们假设每个顺序 计算过程中涉及的过程是确定性的，且 非确定性的唯一来源是由于外部因素引起的上下文切换 scheduler⟦c⟧。我们还指出，LTS是有限的，如果类型为 每个程序变量的 都是有限的，否则 LTS 可以有 无限状态集合。
B : 我们假设计算过程中涉及的每个顺序进程都是确定性的，而唯一导致不确定性的原因是外部调度程序引起的上下文切换。⟦2⟧我们还注意到，如果每个程序变量的类型是有限的，则 LTS 是有限的；否则，LTS 可以有无限的状态集。

## 6  [2312.17527 / body / 占位符 8]
EN: Syntax-guided Synthesis. Our main idea for learning invariant expressions is drawn from syntax-guided synthesis [] . We assume that we are given a grammar [] that defines Boolean-valued formulas over parametric atomic predicates: [] Here, [] expressions are user-supplied, Boolean-valued expressions over the program variables and parameters that we call parametric atomic predicates. Parameters [] in [] are placeholders for constant values of corresponding types. Replacing all parameters with appropriate constants gives a predicate symbol over the program variables.
A : 语法引导合成。我们学习不变表达式的主要思想来源于语法引导合成。⟦2⟧我们假设给定一个语法。⟦3⟧它定义了基于参数化原子谓词的布尔值公式：⟦5⟧这里，⟦6⟧表达式是用户提供的、布尔值的表达式，它们作用于程序变量和参数，我们称之为参数化原子谓词。参数⟦7⟧在⟦8⟧这些参数是对应类型常量值的占位符。将所有参数替换为适当的常量，即可得到程序变量上的谓词符号。
B : 语法引导综合。我们学习不变量表达式的主要思路来自 语法引导综合⟦c⟧。我们假设我们被赋予了 一个定义参数原子谓词上的布尔值公式的语法 ⟦d⟧ ⟦f⟧ 这里，⟦g⟧表达式由用户提供， 对程序变量和参数的布尔值表达式，我们称之为参数原子谓词。⟦i⟧ 中的参数 ⟦h⟧ 是常数值的占位符 相应类型的。将所有参数替换为 常量给出程序变量上的谓词符号。

## 7  [2401.00418 / body / 占位符 18]
EN: It suffices to prove the statement for locality [] . Due to [] there exists a constant [] (depending on [] and [] ) such that for all [] we have [] . [] For [] consider an [] -code with [] and let [] be the corresponding multiset of points in [] . Setting [] , we have [] and [] . Using this and Inequality ( [] ) we conclude
A : 只需证明该陈述在地域上的成立即可。⟦2⟧ 。 由于⟦3⟧存在一个常数⟦4⟧（根据⟦5⟧和⟦6⟧使得对于所有⟦7⟧我们有⟦8⟧。⟦9⟧为了⟦10⟧考虑一下⟦11⟧-代码⟦12⟧并让⟦13⟧是对应于点集的多重集⟦14⟧。 环境⟦15⟧我们有⟦16⟧和⟦17⟧利用这一点和不等式（⟦18⟧我们得出结论
B : 只需证明该陈述为局部性⟦c⟧。由于⟦d⟧，存在一个常⟦e⟧（取决于⟦f⟧和⟦g⟧），使得对于所有⟦h⟧，我们有⟦i⟧.⟦j⟧ 对于 ⟦k⟧ 一个⟦l⟧码，⟦m⟧，设⟦n⟧为⟦o⟧中对应的点的多重集。设置⟦p⟧，我们有⟦q⟧ 以及⟦r⟧。利用此方法和不等式（⟦s⟧），我们得出结论

## 8  [2401.00418 / body / 占位符 25]
EN: Let us first consider [] in [] . Note that a hyperplane [] cannot fully contain all [] for [] . Due to symmetry we assume that [] is not fully contained in [] . If also another triple [] with [] is not fully contained in [] , then we have [] . So, let us assume that [] fully contains all triples [] for [] . If [] , then due to symmetry we assume [] , so that [] is uniquely determined and we have [] since [] is not fully contained in [] . If [] then [] cannot be fully contained in [] , so that [] .
A : 让我们先来看一下⟦d⟧中的⟦c⟧。注意，超平面⟦e⟧无法完全包含⟦g⟧的所有⟦f⟧。由于对称性，我们假设⟦h⟧不完全包含在⟦i⟧中。如果另一个带有⟦k⟧的三重⟦j⟧不完全包含在⟦l⟧中，则有⟦m⟧。那么，我们假设 该⟦n⟧完全包含所有三元组⟦o⟧，代表⟦p⟧。如果⟦q⟧，则由于对称性，我们假设⟦r⟧，因此⟦s⟧是唯一确定的，且 我们有⟦t⟧，因为⟦u⟧并不完全包含在⟦v⟧中。如果⟦w⟧，那么⟦x⟧不能完全包含在⟦y⟧中，因此⟦z⟧。
B : 我们先来考虑一下⟦2⟧在⟦3⟧注意，超平面⟦4⟧无法完全包含所有⟦5⟧为了⟦6⟧由于对称性，我们假设⟦7⟧并未完全包含在⟦8⟧如果还有另一个三元组⟦9⟧和⟦10⟧并未完全包含在⟦11⟧那么，我们就有⟦12⟧所以，我们假设⟦13⟧完全包含所有三元组⟦14⟧为了⟦15⟧。 如果⟦16⟧然后，由于对称性，我们假设⟦17⟧， 以便⟦18⟧具有独特的决定性，我们拥有⟦19⟧自从⟦20⟧并未完全包含在⟦21⟧。 如果⟦22⟧然后⟦23⟧无法完全包含在⟦24⟧， 以便⟦25⟧。

## 9  [2401.00596 / body / 占位符 3]
EN: The observed double-humped structure in net proton distributions is commonly associated with the incoming nucleons from the projectile or target following rapidity loss. Deriving net baryon distributions from net proton distributions and subsequently subtracting the target contribution, universal scaling properties have been revealed [] in the resulting distributions when plotted against shifted rapidity ( [] ). In this approach, the target contribution is parametrized as the average of two exponential functions, []
A : 观测到的净质子分布中的双峰结构通常与入射核子（来自入射粒子或靶核）在快度损失后产生的核子有关。通过从净质子分布推导出净重子分布，并随后减去靶核的贡献，可以揭示出普适的标度性质。⟦1⟧在绘制与移位快度相关的分布图时，所得分布图（⟦2⟧在这种方法中，目标贡献被参数化为两个指数函数的平均值。⟦3⟧
B : 净质子分布中观察到的双峰结构通常与快速丧失后从弹丸或目标进入的核子相关。通过从净质子分布推导出净重子分布，然后减去目标贡献，在与移动速度（⟦c⟧）绘制图时，结果分布中揭示了普遍尺度性质⟦b⟧。在这种方法中，目标贡献被参数化为两个指数函数的平均值⟦d⟧

## 10  [2401.00596 / body / 占位符 16]
EN: Figure [] demonstrates a decrease in [] alongside an increase in [] as the beam energy decreases, reflecting the characteristics of both the phase transition line (with lower [] at higher [] ) and the hydrodynamic freeze-out line characterized by a constant energy density. In the narrow [] window ( [] ), the error bars exhibit noticeable fluctuations in [] and [] , representing changing properties across the transverse plane. Widening the [] window ( [] ) results in a more pronounced increase in [] , while its effect on [] remains marginal. This is because of the stronger variations of increasing [] towards forward and backward rapidities, contrasting with the comparatively smaller changes in decreasing [] [] . These observations hold true for the hydrodynamic results using both NEOS-B (hollow markers) and NEOS-BQS (solid markers).
A : 图⟦b⟧显示，随着束流能量降低，⟦c⟧减少，⟦d⟧增加，反映了相变线（较高⟦f⟧时较低的⟦e⟧）和流体动力学冻结线的特性，其特征是能量密度恒定。在狭窄的⟦g⟧窗口（⟦h⟧）中，误差条在⟦i⟧和⟦j⟧中表现出明显波动，代表横截面性质的变化。扩大⟦k⟧窗口（⟦l⟧）会使⟦m⟧的增加更为明显，而对⟦n⟧的影响则较小。这是因为前进和后退急流时⟦o⟧的增重变化更强，而⟦p⟧⟦q⟧的减弱变化则较小。这些观察结果同样适用于使用NEOS-B（空心标记）和NEOS-BQS（固体标记）进行的流体动力学结果。
B : 数字⟦1⟧显示出下降⟦2⟧与此同时，⟦3⟧随着束流能量的降低，反映了相变线（较低）的特性。⟦4⟧在较高⟦5⟧）以及以恒定能量密度为特征的流体动力学冻结线。在狭窄的⟦6⟧窗户 （⟦7⟧ ），误差线表现出明显的波动⟦8⟧和⟦9⟧表示横向平面上属性的变化。加宽⟦10⟧窗户 （⟦11⟧导致更明显的增加⟦12⟧而它对⟦13⟧仍然微不足道。这是因为增加的波动幅度更大。⟦14⟧向前和向后加速的变化幅度较大，这与减小的变化幅度相对较小形成对比。⟦15⟧⟦16⟧这些观察结果对于使用 NEOS-B（空心标记）和 NEOS-BQS（实心标记）的流体动力学结果都成立。

## 11  [2401.00596 / body / 占位符 0]
EN: Finally, I note that when the theoretical model is not yet sophisticated, it is premature to constrain model parameters using Bayesian inference, even with rapidity-dependent observables. Therefore, it is essential to refine the model description before performing Bayesian calibration. This study will enhance the understanding of longitudinal dynamics in heavy-ion collisions and, consequently, facilitate improving dynamical modeling at beam energy scan energies.
A : 最后，我指出，当理论模型尚不完善时，即使利用快度相关的可观测物理量，使用贝叶斯推断来约束模型参数也为时尚早。因此，在进行贝叶斯校准之前，必须先完善模型描述。这项研究将加深对重离子碰撞中纵向动力学的理解，从而有助于改进束流能量扫描能量下的动力学建模。
B : 最后，我指出，当理论模型尚未成熟时，即使是使用速度依赖的可观测量，使用贝叶斯推断对模型参数进行约束还为时过早。因此，在进行贝叶斯校准前，必须对模型描述进行细化。本研究将加深对重离子碰撞纵向动力学的理解，进而促进在束流能量扫描能量下改进动力学建模。

## 12  [2401.00596 / body / 占位符 0]
EN: In summary, this study emphasizes the significance of rapidity-dependent measurements for model calibration at beam energy scan and revealing QCD properties at finite chemical potentials. The calibrated multistage framework investigated here can aid in interpreting experimental measurements in the second stage of the beam energy scan program.
A : 总之，本研究强调了快度依赖性测量对于束流能量扫描模型校准以及揭示有限化学势下量子色动力学（QCD）性质的重要性。本文研究的校准多阶段框架有助于解释束流能量扫描计划第二阶段的实验测量结果。
B : 总之，本研究强调了快速依赖测量对束流能量扫描模型校准的重要性，以及在有限化学势下揭示QCD特性。这里研究的校准多阶段框架有助于解释束流能量扫描程序第二阶段的实验测量结果。

## 13  [2410.00260 / body / 占位符 2]
EN: We employed bge-large-en-v1.5 [] encoder using sentence transformer [] to convert the textual documents into vector representation. Since the embedding quality degrades when generated for very long documents, we pre-processed the common-crawl data to chunk the documents to maximum length of 2500 words respecting sentence boundaries. We also removed documents with fewer than 20 tokens to remove noise. The embeddings were then generated for the pre-processed documents.
A : 我们使用 bge-large-en-v1.5 ⟦b⟧ 编码器，使用句子变换器 ⟦c⟧ 将文本文档转换为矢量表示。由于嵌入质量在生成非常长文档时会下降，我们对公共爬取数据进行了预处理，将文档分割为最大2500字（符合句子边界）。我们还移除了令牌少于20个的文档以消除噪音。嵌入随后为预处理的文档生成。
B : 我们采用了 bge-large-en-v1.5⟦1⟧使用句子转换器的编码器⟦2⟧将文本文件转换为向量表示。由于对于过长的文档，生成的嵌入质量会下降，因此我们对通用爬虫数据进行了预处理，将文档分段，最大长度为 2500 个单词，并保持句子边界。此外，我们还删除了少于 20 个词元的文档以去除噪声。然后，我们为预处理后的文档生成了嵌入。

## 14  [2410.00260 / body / 占位符 1]
EN: Agriculture: Agriculture is the science, art, or occupation concerned with cultivating land, raising crops, and feeding, breeding, and raising livestock. It also includes the production of livestock, poultry, fish, and crops. All food consumed by people and feed consumed by humans is a result of agriculture. Agricultural crops are also used for many forms of fuel.
A : 农业：农业是与耕种土地、种植作物以及饲养、繁殖和养殖牲畜相关的科学、艺术或职业。它还包括牲畜、家禽、鱼类和农作物的生产。人类消费的所有食物和饲料都源于农业。农作物也被用作多种燃料。
B : 农业： 农业是与耕种土地、种植作物以及饲养、繁殖和饲养牲畜相关的科学、艺术或职业。还包括畜牧、家禽、鱼类和农作物的生产。人类所消费的所有食物和人类所消耗的饲料，都是农业的结果。农作物也被用作多种燃料。

## 15  [2410.00260 / body / 占位符 0]
EN: We propose a versatile prompt template that harnesses the parametric knowledge of a large language model (LLM) to generate diverse and representative seed data tailored to a specific industry domain. By carefully crafting the prompt template and varying factors such as document types, personas, author demeanors, intended audiences, and generation lengths, we create a rich tapestry of seed data that serves as a comprehensive exemplar for the target domain.
A : 我们提出了一种通用的提示模板，它利用大型语言模型（LLM）的参数化知识，生成针对特定行业领域的多样化且具有代表性的种子数据。通过精心设计提示模板并调整文档类型、用户画像、作者风格、目标受众和生成时长等因素，我们构建了一个丰富的种子数据框架，为目标领域提供了一个全面的范例。
B : 我们提出了一种多功能提示模板，利用大型语言模型（LLM）的参数化知识，生成针对特定行业领域多样化且具代表性的种子数据。通过精心设计提示模板，并结合文档类型、人物形象、作者态度、目标受众和生成时长等多种因素，我们打造出丰富的种子数据图景，作为目标领域的全面范例。

## 16  [2410.00260 / body / 占位符 0]
EN: This ablation study suggests that incorporating domain-specific data into LLM training, mined using DoPAMine approach, can effectively enhance the model’s performance on downstream tasks within that domain. DoPAMine plays a crucial role in identifying and selecting relevant and real in-domain data, leading to improved specialization and capability of the trained language model.
A : 本消融研究表明，将领域特定数据纳入使用DoPAMine方法挖掘的LLM训练中，可以有效提升模型在该领域后续任务中的表现。DoPAMine 在识别和选择相关且真实的领域内数据方面发挥着关键作用，从而提升训练语言模型的专业化和能力。
B : 这项消融实验表明，将领域特定数据（通过 DoPAMine 方法挖掘）融入语言模型训练中，可以有效提升模型在该领域下游任务上的性能。DoPAMine 在识别和选择相关且真实的领域内数据方面发挥着至关重要的作用，从而提高了训练后的语言模型的专业化程度和能力。

## 17  [2507.00150 / body / 占位符 17]
EN: Throughout this calculation, the distance from the Sun to the Galactic center and to the plane are set, respectively, at 8.2 and 0.025 kpc [] . The solar velocity vector is set at [] km s-1 [] . For each of the iterations (i.e. positions within the Galaxy), we derived the [] in the MWPotential2014 potential provided by GALPY [] and assumed that [] is independent of [] (our values at any [] correspond to [] kpc). We verified that for most of the sources, the dispersion in [] remained below 2 km s-1. Of course, the [] values depend on the Galactic potential selected, although we assumed that this effect is negligible in a first approach (see discussion in Section [] ).
A : 在整个计算过程中，太阳到银河系中心和银河系平面的距离分别设定为 8.2 千秒差距和 0.025 千秒差距。⟦1⟧太阳速度矢量设定为⟦2⟧公里/秒⟦5⟧对于每次迭代（即银河系内的位置），我们推导出了⟦6⟧在 GALPY 提供的 MWPotential2014 势能中⟦8⟧并假设⟦9⟧与……无关⟦10⟧（我们任何时期的价值观）⟦11⟧对应于⟦12⟧kpc）。我们验证了对于大多数源，色散在⟦13⟧速度保持在 2 km s⁻¹ 以下。当然，⟦16⟧数值取决于所选的银河系势，尽管我们在初步分析中假设这种影响可以忽略不计（参见第 节中的讨论）。⟦17⟧ ）。
B : 在整个计算过程中，太阳到银河中心和该平面的距离分别设定为8.2和0.025 kpc ⟦b⟧。太阳速度矢量设定为⟦c⟧ 公里 s-1 ⟦f⟧。对于每个迭代（即银河系内的位置），我们推导了GALPY ⟦i⟧提供的MWPotential2014势能中的⟦g⟧，并假设⟦j⟧与⟦k⟧无关（我们在任意⟦l⟧的值对应于⟦m⟧ kpc）。我们验证了大多数源的离散在⟦n⟧中保持在2公里S-1以下。当然，⟦q⟧值取决于所选银河势阱，尽管我们假设在初步方法中这种效应可以忽略不计（详见第⟦r⟧节讨论）。

## 18  [2507.00150 / body / 占位符 4]
EN: We computed the past orbits for all the stars in our sample following the same procedure described above and considering the different potentials. New minimum Galactocentric distances were estimated for each of the potentials, as well as their [] (see Table [] ). Independently of the potential considered, the only star with an orbit consistent with [] kpc within uncertainties, thus being possibly originated via the Hills mechanism, is HVS07 with [] kpc (same value obtained before). It is not surprising that these minimum distances are similar to the one previously obtained, since these fast travelers are expected to be less influenced by the MW mass distribution than other objects within the Galaxy in only a few Myr.
A : 我们按照上述相同方法计算了样本中所有恒星的过去轨道，并考虑了不同的势能。每个势阱及其⟦b⟧（见表⟦c⟧）估算了新的最小半乳系中心距离。与考虑的势能无关，唯一一颗在不确定性内轨道一致于⟦d⟧ kpc的恒星，因此可能通过希尔斯机制产生，是具有⟦e⟧ kpc的HVS07（与之前获得的数值相同）。这些最小距离与之前的距离相似并不令人惊讶，因为这些快速旅行者预计在银河系中仅几百万米尔内，受MW质量分布影响较小。
B : 我们按照上述相同步骤，并考虑不同的势函数，计算了样本中所有恒星的过去轨道。针对每种势函数，我们估算了新的最小银心距离及其相关参数。⟦1⟧ （见表）⟦2⟧无论考虑何种势能，唯一一颗轨道与此一致的恒星⟦3⟧在不确定度范围内，kpc，因此可能起源于希尔斯机制，是HVS07，⟦4⟧ kpc（与之前获得的值相同）。这些最小距离与之前获得的值相似并不令人意外，因为预计这些快速行进的天体在短短几百万年内受银河系质量分布的影响小于银河系内的其他天体。

## 19  [2507.00150 / body / 占位符 0]
EN: On the other hand, the apparently most metal-rich star in the sample, HVS16, does not intersect the Galactic plane in its orbital history. Stars with such metallicities and velocities exceeding the local escape speed are promising candidates for an origin in MW satellites such as the LMC or the Sagittarius dwarf galaxy. Finally, stars that crossed the Galactic disk within the last 1 Gyr show a broader metallicity range, suggesting a diversity of stellar populations and possible origins.
A : 另一方面，样本中金属丰度最高的恒星HVS16，在其轨道演化历史中并未与银河系平面相交。具有如此金属丰度和速度超过局部逃逸速度的恒星，很可能起源于银河系卫星星系，例如大麦哲伦星云或人马座矮星系。最后，在过去10亿年内穿过银河系盘面的恒星，其金属丰度范围更广，这表明存在着多种多样的恒星族群和可能的起源。
B : 另一方面，样本中看似金属含量最高的恒星HVS16，在其轨道历史上并未与银河平面相交。具有如此金属丰度且速度超过本地逃逸速度的恒星，是中波卫星（如LMC或人马座矮星系）起源的有力候选。最后，在最后一个金刚期内穿越银河盘的恒星显示出更宽的金属量范围，表明恒星族群和可能的起源存在多样性。

## 20  [2608.29808 / body / 占位符 1]
EN: Our expert panel employs cross-validation using two non-reasoning models for initial analysis. When disagreements arise, a reasoning model is then invoked as an arbiter. This combined approach capitalizes on the efficiency of non-reasoning models for most tasks, reserving the resource-intensive reasoning model for ambiguous or complex cases, thereby achieving an optimal balance between accuracy, stability, and computational expense, which allows PolyFlow to scale to large repositories with analysis stability.
A : 我们的专家组采用交叉验证法，首先使用两个非推理模型进行初步分析。当出现分歧时，则调用推理模型作为仲裁。这种组合方法充分利用了非推理模型在大多数任务中的高效性，并将资源密集型的推理模型用于处理模糊或复杂的情况，从而在准确性、稳定性和计算成本之间实现了最佳平衡，使 PolyFlow 能够扩展到大型存储库并保持分析的稳定性。
B : 我们的专家小组采用两种非推理模型进行交叉验证进行初步分析。当出现分歧时，会调用推理模型作为仲裁者。这种结合方法充分利用了大多数任务中非推理模型的效率，将资源密集型推理模型保留给歧义或复杂情况，从而在准确性、稳定性和计算成本之间取得最佳平衡，使PolyFlow能够以分析稳定性扩展到大型仓库。

## 21  [2608.29808 / body / 占位符 1]
EN: More specifically, Table [] summarizes the full set of cross-language bugs identified in our study and standardizes them into a consistent reporting view. Each row corresponds to one bug and records sixfive fields: a unique Bug ID, a normalized Bug Type (e.g., NULL dereference, OOB read, heap overflow, resource exhaustion), a concise Bug Description, the affected Project, the assigned CVE identifier (if any), and the current Reporting Status. Status labels indicate the lifecycle stage of each finding: pending (not yet confirmed upstream or not yet resolved), confirmed (validated by developer or via CVE assignment), and fixed (patched by maintainers).
A : 更具体地说，表⟦1⟧本报告汇总了我们研究中发现的所有跨语言缺陷，并将其标准化为一致的报告视图。每一行对应一个缺陷，并记录六五个字段：唯一的缺陷 ID、规范化的缺陷类型（例如，空指针解引用、越界读取、堆溢出、资源耗尽）、简明的缺陷描述、受影响的项目、分配的 CVE 编号（如有）以及当前的报告状态。状态标签指示每个缺陷的生命周期阶段：待定（尚未得到上游确认或尚未解决）、已确认（已由开发人员验证或通过 CVE 分配）和已修复（已由维护人员修复）。
B : 更具体地说，表⟦b⟧总结了我们研究中识别出的所有跨语言bug，并将其标准化为一致的报告视图。每一行对应一个错误，记录六五个字段：唯一的错误ID、规范化的错误类型（例如，NULL引用、OOB读取、堆溢出、资源耗尽）、简明的错误描述、受影响的项目、分配的CVE标识符（如有）以及当前报告状态。状态标签表示每个发现的生命周期阶段：待处理（上游尚未确认或尚未解决）， 已确认（由开发者验证或通过CVE分配）， 并被维护者修复（修补）。

## 22  [2608.29808 / body / 占位符 0]
EN: Initially, we scan the project for a range of language features using specialized handler functions; for example, we detect macros and function pointers in C source files, and decorators or dynamic imports in Python. When a handler discovers any such feature, it marks that file for further analysis and adds it to a global worklist. Features that are closely related—for example, macros and conditional compilation—trigger updates to each other’s state so that modifications to one construct can be properly reflected in another. The algorithm then proceeds in a fixed-point manner: if re-analysis of certain files detects new features or modifies existing ones, the corresponding handlers are re-invoked until no further updates are generated.
A : 首先，我们使用专门的处理函数扫描项目中的各种语言特性；例如，检测 C 源文件中的宏和函数指针，以及 Python 中的装饰器或动态导入。当处理函数发现任何此类特性时，它会将该文件标记为待进一步分析，并将其添加到全局工作列表中。密切相关的特性（例如宏和条件编译）会相互触发状态更新，以便对一个构造的修改能够正确地反映在另一个构造中。然后，算法以定点方式运行：如果对某些文件的重新分析检测到新特性或修改了现有特性，则会重新调用相应的处理函数，直到不再产生任何更新为止。
B : 最初，我们会用专门的处理程序函数扫描项目中的各种语言特性;例如，我们在C源文件中检测宏和函数指针，在Python中检测装饰器或动态导入。当处理器发现任何此类特征时，会标记该文件进行进一步分析，并将其添加到全局工作表中。密切相关的特征——例如宏和条件编译——会触发对彼此状态的更新，使对一个构造的修改能够正确反映到另一个构造中。算法随后以固定点方式进行：如果某些文件的重新分析检测到新特征或修改了现有特征，相应的处理程序会被重新调用，直到不再生成任何更新。

## 23  [2608.29808 / body / 占位符 0]
EN: In both Python-C and Java-C subjects, we observe that “hard” language feature usages are routine rather than exceptional. Python-C projects frequently rely on first-class functions and non-trivial native control variability (e.g., conditional compilation and low-level control-flow constructs), while Java-C projects consistently embed native interaction inside object-oriented APIs and commonly introduce additional indirection via reflection and lambda-based callbacks. On the native side, Java-C subjects exhibit denser preprocessor- and indirection-heavy patterns (e.g., function pointers and macros), further complicating static cross-language analysis.
A : 在 Python-C 和 Java-C 学科中，我们观察到“硬”语言特性的使用是常规的，而非例外。Python-C 项目通常依赖一流的函数和非平凡的本地控制变量（例如条件编译和低级控制流结构），而 Java-C 项目则持续将原生交互嵌入面向对象 API 中，并常通过反射和基于 lambda 的回调引入额外的间接交互。在原生端，Java-C 主题表现出更密集的预处理器和间接模式（如函数指针和宏），进一步复杂化静态跨语言分析。
B : 在 Python-C 和 Java-C 案例中，我们观察到“硬性”语言特性的使用是常规的而非例外。Python-C 项目经常依赖于一等函数和非平凡的本地控制可变性（例如，条件编译和底层控制流结构），而 Java-C 项目则始终将本地交互嵌入到面向对象的 API 中，并且通常通过反射和基于 lambda 的回调引入额外的间接层。在本地方面，Java-C 案例表现出更密集的预处理器和间接层密集模式（例如，函数指针和宏），这进一步增加了静态跨语言分析的复杂性。

## 24  [2609.00245 / body / 占位符 3]
EN: A principal source of technicality in this paper is the uniformity required in [] , and hence in [] and [] . We must therefore keep track of what the various constants in our inequalities depend on and of the order of the quantifiers. Thus, the statements of many of our estimates contain a series of quantifiers whose ordering is an essential part of the estimate.
A : 本文技术性的主要来源是要求的一致性。⟦1⟧因此，在⟦2⟧和⟦3⟧因此，我们必须追踪不等式中各个常数所依赖的条件以及量词的顺序。由此可见，我们许多估计式的表述都包含一系列量词，而这些量词的顺序是估计式的重要组成部分。
B : 本文技术性的主要来源是 ⟦b⟧ 中的统一性，因此在 ⟦c⟧ 和 ⟦d⟧ 中也要求一致。因此，我们必须跟踪不等式中各种常数依赖于什么以及量词的顺序。因此，我们许多估计的陈述包含一系列量词，其排序是估计的重要组成部分。

## 25  [2609.00245 / body / 占位符 11]
EN: Let [] be the extension operator constructed by Seeley in [] that maps functions on [] to functions on [] . We treat [] as an operator acting only in the last variable of [] . Thus, [] and for every Hilbert space [] and every [] , [] extends to a bounded map
A : 设⟦c⟧为Seeley在⟦d⟧中构造的扩张算子，将⟦e⟧上的函数映射到⟦f⟧上的函数。我们把⟦g⟧当作只作用于⟦h⟧最后一个变量的算符。因此， ⟦i⟧ 对每个希尔伯特 空间⟦j⟧，每个⟦k⟧，⟦l⟧都扩展到有界映射
B : 让⟦2⟧是 Seeley 构造的扩展运算符⟦3⟧将函数映射到⟦4⟧对函数⟦5⟧我们对待⟦6⟧作为仅作用于最后一个变量的运算符⟦7⟧。 因此，⟦8⟧对于每个希尔伯特空间⟦9⟧以及每一个⟦10⟧，⟦11⟧扩展到有界映射

## 26  [2609.00245 / abstract / 占位符 0]
EN: We establish higher-order Gaussian upper bounds for the heat semigroups associated with a broad class of sectorial maximally subelliptic quadratic forms on manifolds with boundary. Near non-characteristic boundary points and in the interior, we obtain pointwise bounds for all mixed derivatives of the heat kernel in time and along the Hörmander vector fields, expressed in the associated Carnot–Carathéodory geometry. The results apply to operators of arbitrary even order, systems, nonsymmetric forms, and boundary conditions beyond the Dirichlet case.
A : 我们建立了与一类定义在带边界流形上的扇形极大亚椭圆二次型相关的热半群的高阶高斯上界。在非特征边界点附近和流形内部，我们得到了热核在时间和沿Hörmander向量场的所有混合导数的逐点界，这些导数可以用相关的Carnot-Carathéodory几何表示。这些结果适用于任意偶数阶算子、系统、非对称形式以及Dirichlet情形之外的边界条件。
B : 我们为与带有边界的流形上的广义扇形极大亚椭圆二次型相关的热半群建立了高阶高斯上界。在非特征边界点附近和内部，我们得到热核所有混合导数在时间和沿霍尔曼德向量场的点状界限，这些均由相关的卡诺-卡拉西奥多里几何表达。这些结果适用于任意偶数阶的算符、系统、非对称形式以及超越狄利克雷情形的边界条件。

## 27  [2609.00245 / body / 占位符 0]
EN: Once a nearly final draft of this paper was written, and after the mathematical content and proofs were complete, the author used ChatGPT for proofreading and improving the exposition. Otherwise, this article is human generated.
A : 本文的最终稿基本完成，数学内容和证明也已完成之后，作者使用 ChatGPT 进行校对和润色。除此之外，本文其余部分均为人工生成。
B : 当这篇论文几乎完成最终稿，数学内容和证明完成后，作者使用ChatGPT进行校对和完善说明。否则，本文是人工生成的。

## 28  [2609.00246 / body / 占位符 15]
EN: Pthreads offers a mechanism for executing code at most once. This enables resource initialization before thread access, such as opening a shared log file or database connection. Application developers can place such code in [] , but library developers do not control [] and instead rely on [] [] . It provides a type for control variables (which we assume are from set [] ) and a function [] which executes [] and sets [] if it is unset, and otherwise does nothing. The system makes running [] and setting [] appear atomic. Consider the program in [] . [] must allocate and initialize the device before any other library function runs. [] ensures that [] is called exactly once and that the device is initialized before use.
A : Pthreads 提供了一种机制，可以确保代码最多一次执行一次。这使得在线程访问资源之前进行资源初始化成为可能，例如打开共享日志文件或数据库连接。应用程序开发人员可以将此类代码放置在线程线程中。⟦2⟧但库开发者无法控制⟦3⟧相反，则依赖于⟦4⟧⟦5⟧它为控制变量提供了一种类型（我们假设这些变量来自集合）。⟦6⟧ ）和一个函数⟦7⟧执行⟦8⟧和集合⟦9⟧如果未设置，则不执行任何操作；否则，系统运行正常。⟦10⟧和设置⟦11⟧看起来像原子操作。考虑以下程序：⟦12⟧ 。⟦13⟧必须在任何其他库函数运行之前分配并初始化设备。⟦14⟧确保⟦15⟧仅调用一次，并且在使用前对设备进行初始化。
B : Pthreads 提供了最多一次代码执行的机制。这支持在线程访问前进行资源初始化，例如打开共享日志文件或数据库连接。应用开发者可以将此类代码放入 ⟦c⟧，但库开发者不控制 ⟦d⟧ 而是依赖⟦e⟧ ⟦f⟧。它为控制变量（我们假设来自集合 ⟦g⟧）提供了类型和一个函数 ⟦h⟧执行⟦i⟧，如果未被设置则设置⟦j⟧，否则不做任何事。系统让运行⟦k⟧和设置⟦l⟧看起来像原子级的。以⟦m⟧中的程序为例。⟦n⟧ 必须在运行其他库函数之前分配并初始化设备。⟦o⟧ 确保 ⟦p⟧ 被调用一次，并且设备在使用前被初始化。

## 29  [2609.00246 / theorem / 占位符 19]
EN: The auxiliary components are defined inductively along the creation-extended ego lane of the local trace. For traces in init, [] maps every mutex to [] , while [] maps every thread ID to [] . Executing [] in a thread with projected ID [] adds [] to [] . A create action intersects [] with the current lockset for precisely the possible descendant IDs selected by [] in [] . Executing [] removes [] from every entry of [] . Other actions leave both components unchanged. A new thread inherits [] from its creator and starts with a map mapping all thread ids to [] for [] .
A : 辅助组件沿着本地轨迹的创建扩展自我通道进行归纳定义。对于 init 中的轨迹，⟦2⟧将每个互斥锁映射到⟦3⟧， 尽管⟦4⟧将每个线程 ID 映射到⟦5⟧执行⟦6⟧在带有投影 ID 的线程中⟦7⟧添加⟦8⟧到⟦9⟧创建操作交叉⟦10⟧使用当前锁集，精确选择所有可能的后代 ID⟦11⟧在⟦12⟧执行⟦13⟧移除⟦14⟧从每一条记录中⟦15⟧其他操作不会改变这两个组件。新线程继承了该线程。⟦16⟧它由其创建者创建，并以一张映射所有线程 ID 的地图开始。⟦18⟧为了⟦19⟧。
B : 辅助成分沿局部迹的创建延伸自我通道归纳定义。对于初始态中的迹，⟦c⟧映射所有 mutex 映射到 ⟦d⟧，而 ⟦e⟧ 映射每个线程 ID 到 ⟦f⟧。在投影ID ⟦h⟧的线程中执行⟦g⟧会将⟦i⟧ 添加到 ⟦j⟧。创建动作与当前锁集 ⟦k⟧ 相交 正是可能的后代ID 由 选择 ⟦l⟧在⟦m⟧。执行 ⟦n⟧会从⟦p⟧的每个条目中移除⟦o⟧。其他行动离开 两个部件均未改变。一个新线索继承了其创作者的 ⟦q⟧ 并以一个映射开始，将所有线程 ID 映射到 ⟦s⟧ 表示 ⟦t⟧。

## 30  [2609.00246 / body / 占位符 0]
EN: While previous sections covered features that are often completely unhandled, here we deal with complex patterns combining thread creation and mutexes: Creating threads while holding a mutex can simulate barriers on platforms lacking them. Also, then, worker threads do not have to wait for one another:
A : 之前的章节涵盖了许多常常未被完全处理的特征， 这里我们处理结合线程创建和互斥的复杂模式： 在持有互斥器时创建线程可以模拟平台上没有障碍物的障碍物。此外，工作线程之间无需等待：
B : 前面的章节介绍了一些通常完全未被处理的特性，而这里我们将探讨结合线程创建和互斥锁的复杂模式：在持有互斥锁的同时创建线程，可以在缺少屏障的​​平台上模拟屏障。此外，这样一来，工作线程之间就无需相互等待了。

## 31  [2609.00246 / body / 占位符 0]
EN: To demonstrate the kinds of imprecise behavior we found, we present compact benchmarks that some analyzers report as containing a data race but that are actually data-race-free. The following is a representative barrier example:
A : 为了展示我们发现的那些不精确行为，我们呈现了 一些分析器报告的紧凑基准测试存在数据竞赛 但这些实际上是无数据种族的。以下是一个具有代表性的障碍示例：
B : 为了展示我们发现的这类不精确行为，我们提供了几个紧凑的基准测试用例，这些用例会被一些分析器报告为包含数据竞争，但实际上并不存在数据竞争。以下是一个典型的障碍示例：

## 32  [2609.03768 / body / 占位符 4]
EN: Standard AD implementations obtain order [] by repeated differentiation, while operator-overloading libraries nest scalar types. The comparison includes CoDiPack [] , XAD [] , and ADOL-C [] . The present method tabulates the chain rule for the alternating affine maps and elementwise activations. The same tables are used for every layer, neuron, and input point.
A : 标准AD实现获得秩序⟦1⟧通过重复微分，而运算符重载库则嵌套标量类型。此比较包括 CoDiPack。⟦2⟧ ，XAD⟦3⟧以及 ADOL-C⟦4⟧本方法对交替仿射映射和逐元素激活的链式法则进行了列表。每个层、每个神经元和每个输入点都使用相同的表格。
B : 标准AD实现通过重复获得阶⟦b⟧ 微分，而算符过载库则嵌套标量 类型。对比包括CoDiPack ⟦c⟧、XAD ⟦d⟧和ADOL-C ⟦e⟧。本方法的制表方式是 交替仿射映射的链式规则 和 激活。每个层、神经元和 输入点。

## 33  [2609.03768 / body / 占位符 2]
EN: Loss weights can mask this effect. Taylor weights [] weight order 7 by only [] relative to order 1. Residuals constrain derivative combinations: seventh-order ZK reaches 0.06% solution error although its seventh derivatives are twice the exact ones in norm over the ten seventh-order indices the residual uses, and the worst of these exceeds its exact value by a factor of 34 in maximum modulus. Over all 120 seventh-order indices, most of which no residual term constrains, the norm ratio is 6.4.
A : 减重可以掩盖这种效果。泰勒权重 ⟦b⟧ 权重阶7仅按⟦c⟧相对 按顺序1。残差约束导数组合：七阶 ZK的解误差达到0.06%，尽管其七导数为 在十个七阶指标上，范数中的恰合一的两倍 残余用途，其中最严重的会超过其精确值 最大模数为34倍。在120个七阶指标中， 大多数没有剩余项约束，范数比为6.4。
B : 减重可以掩盖这种效应。泰勒权重⟦1⟧仅按重量顺序 7 排序⟦2⟧相对于一阶残差，残差约束导数组合：七阶 ZK 方程的解误差达到 0.06%，尽管其七阶导数在残差所用的十个七阶指标上的范数是精确值的两倍，其中最差的导数最大模值比精确值高出 34 倍。在所有 120 个七阶指标中（其中大多数指标不受残差项约束），范数比为 6.4。

## 34  [2609.03768 / body / 占位符 0]
EN: Unless stated otherwise, the numerical examples use a fixed random seed. The distributed reproduction package generates every table and figure from the corresponding input and output data.
A : 除非另有说明，数值示例均使用固定随机数 种子。分布式重现包生成每一张表和 图基于对应的输入和输出数据。
B : 除非另有说明，数值示例均使用固定的随机种子。分布式复现软件包根据相应的输入和输出数据生成所有表格和图表。

## 35  [2609.03768 / body / 占位符 0]
EN: Possible extensions include variable coefficients, transcendental field nonlinearities, products of more than four factors, and vectorized or parallel batches. Per-point Jacobians can also be used for inverse problems and, with an explicit noise model, for Fisher information.
A : 可能的扩展包括变量系数、超越系数 场非线性，即四个因素以上的乘积，以及 向量化或并行批次。也可以使用每点雅可比矩阵 对于反问题，以及通过显式噪声模型，对于费舍尔 信息。
B : 可能的扩展包括变系数、超越场非线性、四个以上因子的乘积以及向量化或并行批处理。逐点雅可比矩阵也可用于反问题，并且在显式噪声模型下，还可用于费舍尔信息。

## 36  [2609.04056 / body / 占位符 16]
EN: Let [] be the subset of [] whose elements are the [] such that, for all [] such that [] and [] , one has [] . Then [] is a [] -stable subset of [] with [] . We endow [] with a total order by setting [] if and only if [] or [] holds.
A : 设⟦c⟧为⟦d⟧的子集，其元素为⟦e⟧，使得对所有⟦f⟧满足⟦g⟧和⟦h⟧，有⟦i⟧。那么⟦j⟧是⟦l⟧的⟦k⟧稳定子集，⟦m⟧。我们赋予⟦n⟧全序，设⟦o⟧当且仅当⟦p⟧或⟦q⟧成立时。
B : 让⟦2⟧是⟦3⟧其组成元素是⟦4⟧使得对于所有⟦5⟧使得⟦6⟧和⟦7⟧一个人有⟦8⟧。 然后⟦9⟧是一个⟦10⟧-稳定子集⟦11⟧和⟦12⟧我们赋予⟦13⟧通过设置总订单⟦14⟧当且仅当⟦15⟧或者⟦16⟧成立。

## 37  [2609.04056 / body / 占位符 11]
EN: Choose a totally ordered basis of [] consisting of [] and of a basis of [] , with [] as its smallest element. Since PBW-monomials are written in decreasing order, the PBW theorem for [] shows that [] is spanned by the products [] with [] and [] . It therefore suffices to prove that [] for such products.
A : 选择一个全序基⟦c⟧，由⟦d⟧和⟦e⟧基组成，⟦f⟧为其基。 最小元素。由于PBW单项式按递减顺序写出，PBW定理 ⟦g⟧表明⟦h⟧由乘积跨成 ⟦i⟧，⟦j⟧和⟦k⟧。因此，只需证明此类产品的⟦l⟧即可。
B : 选择一个完全有序基⟦2⟧由……组成⟦3⟧并以……为基础⟦4⟧， 和⟦5⟧因为它的最小元素是 。由于 PBW 单项式是按降序排列的，所以 PBW 定理适用于⟦6⟧这表明⟦7⟧涵盖的产品⟦8⟧和⟦9⟧和⟦10⟧因此，只需证明：⟦11⟧适用于此类产品。

## 38  [2609.04056 / body / 占位符 0]
EN: We first show that, in our sufficient condition, only the bad brackets having no bad factor need to be compensated. We then compare this irreducible family with the bad brackets occurring in the conditions of Sussmann, Agrachev–Gamkrelidze and Krastanov.
A : 我们首先表明，在充分条件下，只有那些没有坏因子的坏括号需要补偿。然后我们将该不可约族与Sussmann、Agrachev–Gamkrelidze和Krastanov条件下的坏括号进行比较。
B : 我们首先证明，在我们的充分条件中，只有那些没有坏因子的坏括号才需要补偿。然后，我们将这个不可约族与Sussmann、Agrachev-Gamkrelidze和Krastanov条件中出现的坏括号进行比较。
