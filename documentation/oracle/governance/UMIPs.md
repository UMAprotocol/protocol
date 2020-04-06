# UMIPs

UMIPs (“UMA Improvement Proposals”) are the design documents used to propose changes to the UMA ecosystem. 
They provide information to the UMA community that describes a new feature for the UMA protocol, or its ecosystem. 
The UMIP should provide a concise technical specification of the feature and a rationale for the feature. 
They are modeled after [EIPs](https://eips.ethereum.org/) and [ZEIPs](https://blog.0xproject.com/0x-protocol-governance-voting-walkthrough-and-faq-3becfd57a370). 
See here for an [EIP template](https://github.com/ethereum/EIPs/blob/master/eip-template.md) and [ZEIP template](https://github.com/0xProject/ZEIPs/blob/master/ISSUE_TEMPLATE.md). 

We intend UMIPs to be the primary mechanism for proposing new features, collecting community technical input on an issue, and for documenting the design decisions that have gone into the UMA protocol.
UMIPs are a convenient way to track the progress of an implementation. 

# What is the lifecycle of a UMIP? 

A successful UMIP will move along the following stages: Draft -> Last Call -> Approved -> Final. 
Unsuccessful states are also possible: Abandoned and Rejected.

## Draft
A UMIP that is open for consideration and is undergoing rapid iteration and changes. 
In order to proceed to “Last Call,” the implementation must be complete. 
Every UMIP author is responsible for facilitating conversations and building community consensus for the proposal.

## Last Call
A UMIP that is done with its initial iteration and ready for review by a wide audience. 
If upon review, there is a material change or substantial unaddressed complaints, the UMIP will revert to "Draft". 
If the UMIP requires code changes, the core devs must approve the UMIP and the changes must be merged into the protocol repository. 
A successful UMIP will be in "Last Call" status for a reasonable period of time for comments and be merged (if necessary) before moving to a tokenholder vote. 

## Approved
A UMIP that successfully passes the "Last Call" will be put to UMA tokenholder vote. 

## Final
If tokenholders approve the proposal, the live protocol will be updated to reflect them. The UMIP is then considered to be in the "Final" state. 

## Abandoned
If at any point during the UMIP Finalization Process, a UMIP is abandoned, it will be labeled as such. 
Grounds for abandonment include a lack of interest by the original author(s), or it may not be a preferred option anymore.

## Rejected
A UMIP that is fundamentally broken or rejected by the core team will not be implemented. 

# What are the components of a UMIP?
## Headers
- UMIP <#> 
- UMIP title: <title>
- Author (name or username and email)
- Status: <Draft, Last Call, Approved, Final, Abandoned, Rejected> 
- Created: <date created on>

## Summary (2-5 sentences)
"If you can't explain it simply, you don't understand it well enough." 
Provide a simplified and layman-accessible explanation of the issue.

## Motivation
The motivation is critical to change the UMA protocol. 
It should clearly explain why the existing protocol specification is inadequate with respect to the issue raised.

## Technical Specification
The technical specification should describe the syntax and semantics of the proposed solution for the issue raised. 
If a suggestion is proposed, provide sufficient details so that an implementation would be possible (Proof of Concepts are acceptable).

## Rationale
The rationale should flesh out the specification by describing what motivated the design and why particular design decisions were made, as well as any alternative designs that were considered.

## Implementation
An implementation must be completed before any UMIP proceeds to “Last Call” status.

## Security considerations
All UMIPs must include a discussion of the security implications/considerations relevant to the proposed change as well as proposed mitigations. 
A UMIP cannot proceed to “Final” status without a sufficient security review from the core team. 
