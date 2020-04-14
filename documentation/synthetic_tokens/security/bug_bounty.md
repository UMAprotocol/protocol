# UMA Bug Bounty Program

Security of the platform is our highest priority. 
All contract code and balances are publicly verifiable, and security researchers are eligible for a bug bounty for reporting undiscovered vulnerabilities.

## Audit
<!-- TODO: Add details of audit. 
The contracts have been carefully audited by smart contract security experts [names]. 
The audit report can be found [here].
--> 

UMA encourages the community to audit our contracts and security; we also encourage the responsible disclosure of any issues.
The bug bounty program is intended to recognize the value of working with the community of independent security researchers, and sets out our definition of good faith in the context of finding and reporting vulnerabilities, as well as what you can expect from us in return.

## Rewards
UMA offers substantial rewards for discoveries that can prevent the loss of assets, the freezing of assets, or harm to users. 

Rewards range from $500 to $25,000. 
All rewards will be paid in ETH, and the amount of compensation will vary depending on Severity. 
The severity is calculated according to the [OWASP](https://owasp.org/www-project-risk-assessment-framework/) risk rating model based on Impact and Likelihood.

![](severity.png)

## Scope
<!-- TODO: add version name of DVM 
The scope of our bug bounty program includes core smart contracts related to release [v1.0] of the DVM and financial templates. 
-->
It does not include known issues with the intended behavior. 
Our [documentation site](https://docs.umaproject.org/uma/index.html) has an extensive overview of the intended behavior of the system. 

### In scope:
* DVM contracts [link](https://github.com/UMAprotocol/protocol/tree/master/core/contracts/oracle/implementation)
* Multi-sponsor token contracts [link](https://github.com/UMAprotocol/protocol/tree/master/core/contracts/financial-templates/implementation)

### Examples of what’s in scope:
* Being able to steal funds
* Being able to freeze funds or render them inaccessible by their owners
* Being able to perform replay attacks on the same chain

### Out of scope:
* Issues that have already been submitted by another user or are already known to the UMA team
* Vulnerabilities in contracts built on top of the protocol by third-party developers (such as smart contract wallets)
* Vulnerabilities that require ownership of an admin key
* Any files, modules or libraries other than the ones mentioned above
* More efficient gas solutions
* Any points listed as an already known weaknesses
* Any points listed in an audit report

## Submissions
Please email your submissions to bugs@umaproject.org. 

The submission must include clear and concise steps to reproduce the discovered vulnerability in either written or video format. 

## Terms & Conditions
If you comply with the policies below when reporting a security issue to us, we will not initiate a lawsuit or law enforcement investigation against you in response to your report.

We ask that you:
* Report any vulnerability you’ve discovered promptly.
* Avoid violating the privacy of others, disrupting our systems, destroying data, or harming user experience.
* Use only bugs@umaproject.org to discuss vulnerabilities with us.
<!-- TODO: Clarify what "fixed" means 
* Keep the details of any discovered vulnerabilities confidential until they are fixed and publicly announced by the UMA {foundation?, team?} on {Medium, docs.umaproject.org/bugs, twitter, somewhere else?}.
-->
* Perform testing only on in-scope systems, and respect systems and activities which are out-of-scope.
* Not engage in blackmail, extortion, or any other unlawful conduct.
* Not be a current or former UMA Foundation employee, vendor, contractor, or the employee of an UMA vendor or contractor.

Public disclosure of the bug or the indication of an intention to exploit it on Mainnet will make the report ineligible for a bounty. 
If in doubt about other aspects of the bounty, most of the [Ethereum Foundation bug bounty program rules](https://bounty.ethereum.org/) will apply.

Any questions? 
Reach us via email (bugs@umaproject.org). 
For more information on the UMA platform, check out our [website](http://www.umaproject.org) and [Github](https://github.com/UMAprotocol/).

All reward determinations, including eligibility and payment amount, are made at UMA’s sole discretion. 
UMA reserves the right to reject submissions and alter the terms and conditions of this program without notice.
