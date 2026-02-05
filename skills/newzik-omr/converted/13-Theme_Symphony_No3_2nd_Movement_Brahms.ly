\version "2.24.4"
% automatically converted by musicxml2ly from 13-Theme_Symphony_No3_2nd_Movement_Brahms.musicxml
\pointAndClickOff

\header {
    composer =  Brahms
    encodingsoftware =  "Maestria_v2.7.2"
    encodingdate =  "2026-02-05"
    }

\layout {
    \context { \Score
        skipBars = ##t
        autoBeaming = ##f
        }
    }
PartPOneVoiceOne =  \relative c' {
    \clef "treble" \time 3/4 \key es \major | % 1
    \stemUp c8. ( -1 [ ^ "Moderato" \stemUp d16 ] \bar ".|"
    s2 \repeat volta 2 {
        | % 2
        \stemUp es2. | % 3
        \stemUp g8. [ \stemUp f16 ] \stemUp d4 ) \stemUp c8. ( [ \stemUp
        d16 ] | % 4
        \stemUp es2. | % 5
        \stemUp bes'8. [ \stemUp as16 ] \stemUp d,4 ) \stemUp d8. ( -1 [
        \stemUp es16 ] \break | % 6
        \stemUp f2 ) \stemUp as8. ( [ \stemUp g16 ] | % 7
        \stemUp es2 ) \stemUp g8. ( -5 [ \stemUp f16 ] | % 8
        \stemUp c4. -2 \stemUp d16 [ \stemUp c16 ] \stemUp b8 [ \stemUp
        c8 ] | % 9
        \stemUp d4 ) \stemUp es4 ( -4 \stemUp e4 -1 | \barNumberCheck
        #10
        \stemUp f4 \stemUp bes4. \stemUp as8 \break | % 11
        \stemUp d,4 ) \stemUp g4. ( -5 \stemUp f8 | % 12
        \stemUp c4 \stemUp es4 \stemUp d4 }
    \alternative { {
            | % 13
            \stemUp g2 ) \stemUp c,8. -1 [ \stemUp d16 ] }
        {
            | % 14
            \stemUp c4 \stemUp es4 \stemUp d4 }
        } | % 15
    \stemUp c2 \stemUp g'4 ~ -4 \bar "||"
    \break | % 16
    \key c \major \stemUp g8 [ \stemUp as8 \stemUp f8 \stemUp e8 ]
    \stemUp d4 | % 17
    \stemUp f4 \stemUp e4 \stemUp g4 ( ~ | % 18
    \stemUp g8 [ \stemUp as8 \stemUp f8 \stemUp e8 ] \stemUp d4 | % 19
    \stemUp f4 \stemUp e4 ) \stemDown g'4 -4 \break \pageBreak |
    \barNumberCheck #20
    \stemDown g8 [ \stemDown a8 \stemDown f8 \stemDown e8 ] \stemDown d4
    ~ | % 21
    \stemDown d8 [ \stemDown g8 ( -5 \stemDown e8 \stemDown d8 ]
    \stemDown c4 ~ | % 22
    \stemDown c8 ) [ \stemDown f8 ( -5 \stemDown d8 \stemDown c8 ]
    \stemDown b4 ~ | % 23
    \stemDown b8 ) [ \stemDown c8 -3 \stemDown b8 \stemDown c8 ]
    \stemDown b4 ~ | % 24
    \stemUp b8 [ \stemUp a8 -1 \stemUp gis8 -2 \stemUp a8 -1 ] \stemDown
    b4 ~ \break | % 25
    \stemDown b8 [ \stemDown c8 ( \stemDown b8 \stemDown e8 ] \stemDown
    c4 ~ ^ "Am" | % 26
    \stemUp c8 ) [ \stemUp a8 ( \stemUp gis8 \stemUp a8 ] \stemDown b4 ~
    | % 27
    \stemDown b8 ) [ \stemDown c8 ( -2 ^ "N.C." \stemDown b8 \stemDown c8
    \stemDown d8 \stemDown e8 ] | % 28
    \stemDown f8 [ \stemDown e8 \stemDown es8 \stemDown d8 ) ] \stemDown
    c8. -1 [ \stemDown d16 ] \bar "||"
    \break | % 29
    \key es \major \stemDown es2. | \barNumberCheck #30
    \stemDown g8. [ \stemDown f16 ] \stemDown d4 \stemDown c8. ( [
    \stemDown d16 ] | % 31
    \stemDown es2. | % 32
    \stemDown bes'8. [ \stemDown as16 ] \stemDown d,4 ) \stemDown d8. (
    [ \stemDown es16 ] \break | % 33
    \stemDown f2 ) \stemDown as8. ( [ \stemDown g16 ] | % 34
    \stemDown es2 ) \stemDown g8. ( [ \stemDown f16 ] | % 35
    \stemDown c4. \stemDown d16 [ \stemDown c16 ] \stemDown b8 [
    \stemDown c8 ] | % 36
    \stemDown d4 ) \once \override NoteHead.style = #'la \stemDown es4 (
    \stemDown e4 \break | % 37
    \stemDown f4 \stemDown bes4. \stemDown as8 | % 38
    \stemDown d,4 ) \stemDown g4. ( \stemDown f8 | % 39
    \stemDown c4 \stemDown es4 \stemDown d4 | \barNumberCheck #40
    \stemDown c2 ) r4 \bar "|."
    }

PartPOneVoiceOneChords =  \chordmode {
    | % 1
    s8. s16 \bar ".|"
    s2 \repeat volta 2 {
        | % 2
        c2.:m5 | % 3
        f8.:m5 s16 s4 s8. s16 | % 4
        c2.:m5 | % 5
        e8.:m5 s16 s4 s8. s16 | % 6
        b2:dim5 s8. s16 | % 7
        c2:m5 s8. s16 | % 8
        a4.:dim5m7 s16 s16 s8 s8 | % 9
        g4:5 c4:m5 c4:7 | \barNumberCheck #10
        f4:m5 s4. s8 | % 11
        bes4:5 es4.:5 s8 | % 12
        as4:5 c4:m5 d4:5 }
    \alternative { {
            | % 13
            g2:7 c2:m5 f8.:m6 }
        {
            | % 14
            as4:5 c4:m5 g4:7 }
        } | % 15
    c2:5 \bar "||"
    f8:m5 s16 s8 s4 | % 17
    c4:5 s4 s4 | % 18
    f8:m5 s8 s8 s8 s4 | % 19
    c4:5 s4 s4 | \barNumberCheck #20
    f8:5 s8 s8 b8:dim5m7 s4 | % 21
    e8:m5 s8 s8 s8 a4:m7 | % 22
    d8:m7 s8 s8 s8 d4:m6 | % 23
    e8:5 s8 s8 s8 s4 | % 24
    s8 s8 s8 s8 s4 | % 25
    s8 s8 s8 s8 s4 | % 26
    s8 s8 s8 s8 s4 | % 27
    s8 s8 s8 s8 s8 s8 | % 28
    s8 s8 s8 s8 s8. s16 \bar "||"
    c2.:m5 | \barNumberCheck #30
    f8.:m5 s16 s4 s8. s16 | % 31
    c2.:m5 | % 32
    f8.:m5 s16 s4 s8. s16 | % 33
    b2:dim5 s8. s16 | % 34
    c2:m5 s8. s16 | % 35
    as4.:5 s16 s16 s8 s8 | % 36
    g4:5 c4:m5 c4:7 | % 37
    f4:m5 s4. s8 | % 38
    bes4:5 es4.:5 s8 | % 39
    as4:5 c4:m5 g4:7 | \barNumberCheck #40
    c2:5 s4 \bar "|."
    }

PartPOneVoiceTwo =  \relative g {
    \clef "bass" \time 3/4 \key es \major | % 1
    r4 \bar ".|"
    s2 \repeat volta 2 {
        | % 2
        r8 \stemUp g8 \stemUp c4 \stemUp g4 | % 3
        \stemDown <f as>2. -13 | % 4
        r8 \stemUp g8 \stemUp c4 \stemUp g4 | % 5
        \stemDown <f as>2. \break | % 6
        r8 \stemUp d8 \stemUp as'4 \stemUp d,4 | % 7
        r8 \stemUp g8 \stemUp c4 \stemUp g4 | % 8
        \stemDown as2 -2 \stemDown as4 | % 9
        \stemDown <g b>4 \stemDown <c, c'>4 \stemDown bes'4 |
        \barNumberCheck #10
        \stemDown as4 \stemDown <f as>2 \break | % 11
        \stemDown bes4 \stemDown <es, bes'>2 | % 12
        \stemDown as4 \stemDown g4 \stemDown fis4 }
    \alternative { {
            | % 13
            \stemDown <f b>4 \stemDown <es c'>4 \stemDown d4 }
        {
            | % 14
            \stemDown as'4 \stemDown g4 \stemUp <g, f'>4 }
        } | % 15
    \stemDown <c e>2 r4 \bar "||"
    \break | % 16
    \key c \major \stemDown <c as'>2. | % 17
    \stemDown <c g'>2. | % 18
    \stemDown <c as'>2. | % 19
    \stemDown <c g'>2 \stemDown <e b' c>4 \break \pageBreak |
    \barNumberCheck #20
    \stemDown <f a c>2 \stemDown <b, f' a>4 | % 21
    \stemDown <e g>2 \stemDown <a, g'>4 | % 22
    \stemDown <d f>2 \stemDown <f a>4 | % 23
    \stemDown <e gis>2. | % 24
    \stemDown e2. \break | % 25
    \stemDown <e gis>2 \stemDown a4 | % 26
    \stemDown e2. | % 27
    \stemDown <e gis>4 r4 r4 | % 28
    R2. \bar "||"
    \break | % 29
    \key es \major r8 \stemUp g8 \stemUp c4 \stemUp g4 | \barNumberCheck
    #30
    \stemDown <f as>2. | % 31
    r8 \stemUp g8 \stemUp c4 \stemUp g4 | % 32
    \stemDown <f as>2. \break | % 33
    r8 \stemUp d8 \stemUp as'4 \stemUp d,4 | % 34
    r8 \stemUp g8 \stemUp c4 \stemUp g4 | % 35
    \stemDown as2 \stemDown as4 | % 36
    \stemDown <g b>4 \stemDown <c, c'>4 \stemDown bes'4 \break | % 37
    \stemDown as4 \stemDown <f as>2 | % 38
    \stemDown bes4 \stemDown <es, bes'>2 | % 39
    \stemDown as4 \once \override NoteHead.style = #'la \stemDown g4
    \stemUp <g, f'>4 | \barNumberCheck #40
    \stemDown <c e>2 \fermata r4 \bar "|."
    }

PartPOneVoiceThree =  \relative c {
    \clef "bass" \time 3/4 \key es \major s4 \bar ".|"
    s2 \repeat volta 2 {
        | % 2
        \stemDown c2. -5 | % 3
        s2. | % 4
        \stemDown c2. | % 5
        s2. \break | % 6
        \stemDown b2. | % 7
        \stemDown c2. | % 8
        s2. | % 9
        s2. | \barNumberCheck #10
        s2. \break | % 11
        s2. | % 12
        s2. }
    \alternative { {
            | % 13
            s2. }
        {
            | % 14
            s2. }
        } | % 15
    s2. \bar "||"
    \break | % 16
    \key c \major s2. | % 17
    s2. | % 18
    s2. | % 19
    s2. \break \pageBreak | \barNumberCheck #20
    s2. | % 21
    s2. | % 22
    s2. | % 23
    s2. | % 24
    s2. \break | % 25
    s2. | % 26
    s2. | % 27
    s2. | % 28
    s2. \bar "||"
    \break | % 29
    \key es \major \stemDown c2. | \barNumberCheck #30
    s2. | % 31
    \stemDown c2. | % 32
    s2. \break | % 33
    \stemDown b2. | % 34
    \stemDown c2. | % 35
    s2. | % 36
    s2. \break | % 37
    s2. | % 38
    s2. | % 39
    s2. | \barNumberCheck #40
    s2. \bar "|."
    }


% The score definition
\score {
    <<
        
        \context ChordNames = "PartPOneVoiceOneChords" { \PartPOneVoiceOneChords}
        \new PianoStaff
        <<
            
            \context Staff = "1" << 
                \mergeDifferentlyDottedOn\mergeDifferentlyHeadedOn
                \context Voice = "PartPOneVoiceOne" {  \PartPOneVoiceOne }
                >> \context Staff = "2" <<
                \mergeDifferentlyDottedOn\mergeDifferentlyHeadedOn
                \context Voice = "PartPOneVoiceTwo" {  \voiceOne \PartPOneVoiceTwo }
                \context Voice = "PartPOneVoiceThree" {  \voiceTwo \PartPOneVoiceThree }
                >>
            >>
        
        >>
    \layout {}
    % To create MIDI output, uncomment the following line:
    %  \midi {\tempo 4 = 100 }
    }

