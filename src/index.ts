import { Block, FunctionDeclaration, IfStatement, Node, Project, ReturnStatement, Statement, SyntaxKind, ThrowStatement, TryStatement, ts } from 'ts-morph';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import _ from 'lodash';

const project = new Project({});

class ReturnValue {
  name?: string;
  fn?: FunctionDeclaration;
  successBranches: Statement<ts.Statement>[][] = [];
  failBranches: Statement<ts.Statement>[][] = [];

  get branches() {
    return [...this.successBranches, ...this.failBranches].filter(b => b.length > 0);
  }
}

const walk = (
  fn: FunctionDeclaration | IfStatement | TryStatement, 
  depth: number = 0,
  type: string = '',
  value = new ReturnValue()
) => {
  let success: Statement<ts.Statement>[] = [];
  let fail: Statement<ts.Statement>[] = [];

  if(fn instanceof IfStatement) {
    const thenStatement = fn.getThenStatement();
    const elseStatement = fn.getElseStatement();
    success = thenStatement instanceof Block ? thenStatement.getStatements() : [thenStatement];
    fail = elseStatement instanceof Block ? elseStatement.getStatements() : elseStatement ? [elseStatement] : [];
  } else if(fn instanceof TryStatement) {
    success = fn.getTryBlock().getStatements();
    fail = fn.getCatchClause()?.getBlock().getStatements() || [];
  } else {
    success = fn.getStatements();
  }

  success = _.filter(success, item => [SyntaxKind.IfStatement, SyntaxKind.TryStatement, SyntaxKind.ReturnStatement, SyntaxKind.ThrowStatement].includes(item.getKind()));
  fail = _.filter(fail, item => [SyntaxKind.IfStatement, SyntaxKind.TryStatement, SyntaxKind.ReturnStatement, SyntaxKind.ThrowStatement].includes(item.getKind()));
  
  value.name = fn instanceof FunctionDeclaration ? fn.getName() : value.name;
  value.fn = fn instanceof FunctionDeclaration ? fn : value.fn;

  if(value.successBranches.length === 0 && !(fn instanceof FunctionDeclaration)) {
    value.successBranches.push([fn]);
  } else {
    _.last(value.successBranches)?.push(fn);
  }

  if(fail.length && value.failBranches.length === 0 && !(fn instanceof FunctionDeclaration)) {
    value.failBranches.push([fn]);
  } else {
    _.last(value.failBranches)?.push(fn);
  }

  success.forEach(item => {
    if(item instanceof TryStatement) {
      walk(item, depth + 1, 'try', value);
    }
    if(item instanceof IfStatement) {
      walk(item, depth + 1, 'if', value);
    }
    if(item instanceof ReturnStatement || item instanceof ThrowStatement) {
      _.last(value.successBranches)?.push(item);
      value.successBranches.push([]);
    }
  });

  fail.forEach(item => {
    if(item instanceof TryStatement) {
      walk(item, depth + 1, 'catch', value);
    }
    if(item instanceof IfStatement) {
      walk(item, depth + 1, 'else', value);
    }
    if(item instanceof ReturnStatement || item instanceof ThrowStatement) {
      _.last(value.failBranches)?.push(item);
      value.failBranches.push([]);
    }
  });

  return value;
};

yargs(hideBin(process.argv))
  .command('analyze <path>', '', () => {}, async (argv: {path: string}) => {
    project.addSourceFileAtPath(argv.path);
    const file = project.getSourceFile(argv.path);
    const functions = file?.getFunctions();
    const exportFunctions = _.filter(functions, fn => _.some(fn.getModifiers(), modifier => modifier.getKind() === SyntaxKind.ExportKeyword));
    
    exportFunctions.forEach(fn => {
      const info = walk(fn);
      const parameters = `${info.fn?.getParameters().map(p => p.getName()).join(', ')}`;
      
      if(info.branches.length === 0) {
        console.log(`test('${info.name}', async () => {`);
        console.log(`  // const result = ${info.name}(${parameters})`);
        console.log('});\n');
      }

      info.successBranches.forEach(branch => {
        if(_.isEmpty(branch)) return;
        const branchMapStr = branch.map(b => b.getKindName()).join('->');
        console.log(`test('${info.name} - ${branchMapStr}', async () => {`);
        console.log(`  // const result = ${info.name}(${parameters})`);
        branch.forEach(item => {
          if(item instanceof IfStatement) {
            console.log(`  //${item.getExpression().getText()}`);
          }
          if(item instanceof TryStatement) {
            console.log(`  // try`);
          }
          if(item instanceof ThrowStatement) {
            console.log(`  // await expect(result).rejects.toThrow(${item.getExpression().getText()})`)
          }
          if(item instanceof ReturnStatement) {
            console.log(`  // await expect(result).resolves.toMatchObject(${item.getExpression()?.getText()})`)
          }
        })
        console.log('});\n')
      });
      info.failBranches.forEach(branch => {
        if(_.isEmpty(branch)) return;
        const branchMapStr = branch.map(b => b.getKindName()).join('->');
        console.log(`test('${info.name} - ${branchMapStr}', async () => {`)
        console.log(`  // const result = ${info.name}(${parameters});`);

        branch.forEach(item => {
          if(item instanceof IfStatement) {
            console.log(`  // else (${item.getExpression().getText()})`);
          }
          if(item instanceof TryStatement) {
            console.log(`  // catch`);
          }
          if(item instanceof ThrowStatement) {
            console.log(`  // await expect(result).rejects.toThrow(${item.getExpression().getText()})`)
          }
          if(item instanceof ReturnStatement) {
            console.log(`  // await expect(result).resolves.toMatchObject(${item.getExpression()?.getText()})`)
          }
        })
        console.log('});ֿ\n')
      });
    });
    
  })
  .argv


