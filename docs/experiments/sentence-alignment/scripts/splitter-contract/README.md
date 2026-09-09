# The splitter's contract, across every fixture

`sentenceCuts` went through eight review rounds, each finding a real case the previous fix had not
covered. Rather than wait for a ninth, this checks the properties themselves over every block in
both wire formats, with `visibleTextOf` supplying the slot text as production will.

```
npx tsx contract.mts
```

With #126 at 2d422f5:

```
8293 blocks × formats, 8211 cuts

lengths do not sum to the input   0
zero- or negative-length sentence 0
cut inside a placeholder          0
cut immediately after an open tag 0
```

**Two of these checks were validated by mutation, and one of them started out vacuous.** Breaking
the final length reports 8293 violations. Disabling the rewind over opening tags reported *nothing*
at first: a cut landing just past `<t id="N">` is at the tag's end, not inside it, so the
"inside a placeholder" test never fired. The property that rewind actually protects is that a cut
must not immediately follow an opening tag — with that check added, the same mutation reports 50.
